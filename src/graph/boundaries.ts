/**
 * Architecture boundaries: deny-rules enforced at index time.
 *
 * Inspired by codegraph-rust's `codegraph.boundaries.toml`.
 *
 * Format: `stellaris.boundaries.json` at project root:
 * {
 *   "deny": [
 *     { "from": "src/ui/**", "to": "src/db/**", "reason": "UI must not import DB directly" },
 *     { "from": "src/domain/**", "to": "src/infra/**", "reason": "domain layer purity" }
 *   ]
 * }
 *
 * `from` / `to` are glob-style patterns matched against relative file paths.
 * Supported syntax: `*` (one segment), `**` (any depth), `?` (one char).
 * Optional `name` for display; `reason` is surfaced in violations.
 *
 * The boundary check runs every time edges are persisted for a file. Violations
 * are written to a dedicated table and exposed via `get_boundary_violations`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DenyRule {
  name?: string;
  from: string;
  to: string;
  reason?: string;
}

export interface BoundariesConfig {
  deny: DenyRule[];
}

export interface CompiledRule {
  name: string;
  from: RegExp;
  to: RegExp;
  reason: string;
  fromPattern: string;
  toPattern: string;
}

/**
 * Convert a glob-style pattern to a regex. Supported: `**`, `*`, `?`.
 * Matches against forward-slash relative paths.
 */
function globToRegex(glob: string): RegExp {
  // Escape regex specials, then translate glob tokens
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // **  → match anything including /
        re += '.*';
        i += 2;
        // consume an optional trailing / so `src/**/x` works
        if (glob[i] === '/') i++;
        continue;
      }
      // *  → match any non-slash sequence
      re += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (/[.+^${}()|[\]\\]/.test(c)) { re += '\\' + c; i++; continue; }
    re += c; i++;
  }
  return new RegExp('^' + re + '$');
}

let cachedRules: CompiledRule[] | null = null;
let cachedRoot: string | null = null;

/**
 * Load and compile boundaries rules from `stellaris.boundaries.json`.
 * Returns [] if the file is missing or invalid.
 * Result is cached per projectRoot until `resetBoundariesCache()`.
 */
export async function loadBoundaries(projectRoot: string): Promise<CompiledRule[]> {
  if (cachedRules && cachedRoot === projectRoot) return cachedRules;

  const configPath = join(projectRoot, 'stellaris.boundaries.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as BoundariesConfig;
    if (!parsed.deny || !Array.isArray(parsed.deny)) {
      cachedRules = [];
      cachedRoot = projectRoot;
      return cachedRules;
    }
    cachedRules = parsed.deny.map((rule, idx) => ({
      name: rule.name ?? `rule_${idx + 1}`,
      from: globToRegex(rule.from),
      to: globToRegex(rule.to),
      reason: rule.reason ?? 'no reason provided',
      fromPattern: rule.from,
      toPattern: rule.to,
    }));
    cachedRoot = projectRoot;
    console.error(`[Stellaris] Loaded ${cachedRules.length} boundary rule(s) from stellaris.boundaries.json`);
    return cachedRules;
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(`[Stellaris] Warning: failed to parse stellaris.boundaries.json: ${err.message}`);
    }
    cachedRules = [];
    cachedRoot = projectRoot;
    return cachedRules;
  }
}

export function resetBoundariesCache(): void {
  cachedRules = null;
  cachedRoot = null;
}

/**
 * Check a single edge (source → target) against all rules.
 * Returns matched rules (empty if no violation).
 */
export function checkEdge(
  source: string,
  target: string,
  rules: CompiledRule[],
): CompiledRule[] {
  return rules.filter(r => r.from.test(source) && r.to.test(target));
}
