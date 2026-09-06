import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RC_FILENAME = '.stellarisrc';

export interface StellarisRc {
  auto_index: boolean;
  /** Embedding provider: 'openai' | 'voyage' | 'ollama' (default: openai) */
  embedding_provider?: 'openai' | 'voyage' | 'ollama';
  /** Model override for the embedding provider */
  embedding_model?: string;
  /** Re-ranking provider: 'off' | 'voyage' | 'cohere' (default: off) */
  rerank_provider?: 'off' | 'voyage' | 'cohere';
  /** Database connection string (stored in plaintext — ensure .stellarisrc is gitignored) */
  db_connection_string?: string;
  /** Database provider override ('postgres' | 'mysql' | 'sqlite' | 'auto') */
  db_provider?: 'postgres' | 'mysql' | 'sqlite' | 'auto';
  /** If true, refresh DB schema snapshot on every Stellaris startup */
  db_auto_snapshot?: boolean;
  /** Comma-separated DB schemas to introspect (default: public) */
  db_schemas?: string[];
  // Import-alias overrides use `alias.<name>=<path>` lines (e.g. `alias.@=src`).
  // They are read directly by src/graph/resolver.ts (highest-priority alias
  // source) and intentionally not parsed here — this struct is for runtime
  // config, alias keys are variadic and resolver-specific.
}

const DEFAULTS: StellarisRc = {
  auto_index: false,
};

/**
 * Parse a simple KEY=VALUE rc file.
 */
function parseRc(raw: string): Partial<StellarisRc> {
  const result: Partial<StellarisRc> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    switch (key) {
      case 'auto_index':
        result.auto_index = value === 'true';
        break;
      case 'embedding_provider':
        result.embedding_provider = value as StellarisRc['embedding_provider'];
        break;
      case 'embedding_model':
        result.embedding_model = value;
        break;
      case 'rerank_provider':
        result.rerank_provider = value as StellarisRc['rerank_provider'];
        break;
      case 'db_connection_string':
        result.db_connection_string = value;
        break;
      case 'db_provider':
        result.db_provider = value as StellarisRc['db_provider'];
        break;
      case 'db_auto_snapshot':
        result.db_auto_snapshot = value === 'true';
        break;
      case 'db_schemas':
        result.db_schemas = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
    }
  }
  return result;
}

/**
 * Read .stellarisrc from project root. Returns defaults if not found.
 */
export async function loadStellarisRc(projectRoot: string): Promise<StellarisRc> {
  const rcPath = join(projectRoot, RC_FILENAME);
  try {
    const raw = await readFile(rcPath, 'utf-8');
    return { ...DEFAULTS, ...parseRc(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Keys this writer owns. Everything else (alias.*, comments, unknown keys)
 * is preserved in-place so reindex/enable_auto_index cannot wipe resolver config.
 */
function managedUpdates(rc: StellarisRc): Record<string, string | undefined> {
  return {
    auto_index: String(rc.auto_index),
    embedding_provider: rc.embedding_provider,
    embedding_model: rc.embedding_model,
    rerank_provider: rc.rerank_provider,
    db_connection_string: rc.db_connection_string,
    db_provider: rc.db_provider && rc.db_provider !== 'auto' ? rc.db_provider : undefined,
    db_auto_snapshot: rc.db_auto_snapshot ? 'true' : undefined,
    db_schemas: rc.db_schemas && rc.db_schemas.length > 0 ? rc.db_schemas.join(',') : undefined,
  };
}

/**
 * Write .stellarisrc to project root.
 * Merges into an existing file instead of replacing it.
 */
export async function saveStellarisRc(projectRoot: string, rc: StellarisRc): Promise<void> {
  const rcPath = join(projectRoot, RC_FILENAME);
  let existing = '';
  try {
    existing = await readFile(rcPath, 'utf-8');
  } catch {
    existing = '';
  }

  const updates = managedUpdates(rc);

  if (!existing) {
    const lines = [
      '# Stellaris Code Search configuration',
      '# Set auto_index=true to enable automatic incremental indexing on startup',
      `auto_index=${rc.auto_index}`,
    ];
    if (rc.embedding_provider) lines.push(`embedding_provider=${rc.embedding_provider}`);
    if (rc.embedding_model) lines.push(`embedding_model=${rc.embedding_model}`);
    if (rc.rerank_provider) lines.push(`rerank_provider=${rc.rerank_provider}`);
    if (rc.db_connection_string) {
      lines.push('');
      lines.push('# Database schema introspection (connection string stored in plaintext)');
      lines.push(`db_connection_string=${rc.db_connection_string}`);
    }
    if (updates.db_provider) lines.push(`db_provider=${updates.db_provider}`);
    if (updates.db_auto_snapshot) lines.push(`db_auto_snapshot=${updates.db_auto_snapshot}`);
    if (updates.db_schemas) lines.push(`db_schemas=${updates.db_schemas}`);
    lines.push('');
    await writeFile(rcPath, lines.join('\n'), 'utf-8');
    return;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const next = updates[key];
    if (next !== undefined) {
      out.push(`${key}=${next}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && !seen.has(key)) {
      out.push(`${key}=${value}`);
    }
  }
  const text = out.join('\n').replace(/\n+$/, '\n');
  await writeFile(rcPath, text, 'utf-8');
}
