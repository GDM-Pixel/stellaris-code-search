/**
 * Response tiering + truncation utilities.
 *
 * Inspired by codegraph-rust:
 *   - codegraph-mcp-core/src/context_aware_limits.rs (tier classification)
 *   - codegraph-mcp-tools/src/graph_tool_executor.rs (truncate_if_oversized + _truncated metadata)
 *
 * Goal: prevent large tool results from silently overflowing the calling LLM's context window.
 * Strategy:
 *   1. Classify the LLM's context window into a tier (small / medium / large / massive).
 *   2. Each tier has a default `limit` multiplier and a `maxResultBytes` budget.
 *   3. After producing a result, if the JSON exceeds the byte budget, trim array fields
 *      and inject `_truncated: { truncated_items, original_count }` so the LLM knows
 *      it got partial data.
 *
 * Configuration: STELLARIS_CONTEXT_WINDOW env var (default: 128000).
 */

export type ContextTier = 'small' | 'medium' | 'large' | 'massive';

export interface TierConfig {
  tier: ContextTier;
  contextWindow: number;
  /** Recommended default `limit` for array-returning tools. */
  defaultLimit: number;
  /** Hard cap on `limit` — tools should clamp to this. */
  maxLimit: number;
  /** Max JSON byte size before truncation kicks in. */
  maxResultBytes: number;
  /** Recommended max depth for graph traversal tools (blast radius, dependencies). */
  maxGraphDepth: number;
}

function classifyTier(contextWindow: number): ContextTier {
  if (contextWindow < 50_000) return 'small';
  if (contextWindow < 150_000) return 'medium';
  if (contextWindow < 500_000) return 'large';
  return 'massive';
}

/**
 * Read STELLARIS_CONTEXT_WINDOW from env, defaulting to 128k.
 * Re-read on every call so users can change it without restarting.
 */
export function getContextWindow(): number {
  const raw = process.env.STELLARIS_CONTEXT_WINDOW;
  if (!raw) return 128_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 128_000;
  return n;
}

export function getTierConfig(): TierConfig {
  const contextWindow = getContextWindow();
  const tier = classifyTier(contextWindow);

  switch (tier) {
    case 'small':
      return {
        tier, contextWindow,
        defaultLimit: 10, maxLimit: 25,
        maxResultBytes: 30_000,
        maxGraphDepth: 2,
      };
    case 'medium':
      return {
        tier, contextWindow,
        defaultLimit: 25, maxLimit: 50,
        maxResultBytes: 80_000,
        maxGraphDepth: 3,
      };
    case 'large':
      return {
        tier, contextWindow,
        defaultLimit: 50, maxLimit: 100,
        maxResultBytes: 200_000,
        maxGraphDepth: 4,
      };
    case 'massive':
      return {
        tier, contextWindow,
        defaultLimit: 100, maxLimit: 200,
        maxResultBytes: 400_000,
        maxGraphDepth: 5,
      };
  }
}

/**
 * Clamp a user-provided `limit` to the current tier's maxLimit, falling back
 * to defaultLimit if undefined.
 */
export function clampLimit(userLimit: number | undefined, opts?: { defaultLimit?: number }): number {
  const cfg = getTierConfig();
  if (userLimit === undefined || !Number.isFinite(userLimit) || userLimit <= 0) {
    return opts?.defaultLimit ?? cfg.defaultLimit;
  }
  return Math.min(Math.floor(userLimit), cfg.maxLimit);
}

/**
 * Truncate result object if its JSON size exceeds the tier byte budget.
 *
 * Strategy:
 *   - If the result has array fields at the top level, trim them from the end
 *     until the JSON fits the budget.
 *   - Inject `_truncated` metadata so the LLM knows the data is partial.
 *   - If still too large after trimming all arrays, return a structured error
 *     placeholder (caller should call with a smaller `limit`).
 *
 * Arrays are trimmed in priority order: first the largest-named array (heuristic).
 * The caller can pass `arrayFields` to control trim order explicitly.
 */
export function truncateIfOversized<T extends Record<string, unknown>>(
  result: T,
  arrayFields?: string[],
): T & { _truncated?: { truncated_items: number; original_count: number; fields: string[] } } {
  const cfg = getTierConfig();
  const initialSize = byteSize(result);
  if (initialSize <= cfg.maxResultBytes) return result;

  // Discover array fields if not provided
  const fields = arrayFields ?? Object.keys(result).filter(k => Array.isArray((result as any)[k]));
  if (fields.length === 0) {
    // No arrays to trim — inject a warning and return as-is
    return {
      ...result,
      _truncated: { truncated_items: 0, original_count: 0, fields: [] },
    };
  }

  // Sort fields by descending serialized size so we trim the heaviest first
  const fieldsBySize = [...fields].sort((a, b) => byteSize((result as any)[b]) - byteSize((result as any)[a]));

  const truncated: any = { ...result };
  const originalCounts: Record<string, number> = {};
  let totalTruncated = 0;
  const trimmedFields: string[] = [];

  for (const field of fieldsBySize) {
    const arr = truncated[field];
    if (!Array.isArray(arr)) continue;
    originalCounts[field] = arr.length;

    while (truncated[field].length > 0 && byteSize(truncated) > cfg.maxResultBytes) {
      // Trim ~10% per iteration to converge fast on huge arrays
      const removeCount = Math.max(1, Math.floor(truncated[field].length * 0.1));
      truncated[field] = truncated[field].slice(0, -removeCount);
      totalTruncated += removeCount;
    }
    if (truncated[field].length < arr.length) {
      trimmedFields.push(field);
    }
    if (byteSize(truncated) <= cfg.maxResultBytes) break;
  }

  const originalTotal = Object.values(originalCounts).reduce((a, b) => a + b, 0);

  truncated._truncated = {
    truncated_items: totalTruncated,
    original_count: originalTotal,
    fields: trimmedFields,
    tier: cfg.tier,
    max_bytes: cfg.maxResultBytes,
    hint: `Result exceeded ${cfg.tier}-tier budget. Reduce 'limit' or scope to see less data per call.`,
  };

  return truncated;
}

function byteSize(obj: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  } catch {
    return 0;
  }
}
