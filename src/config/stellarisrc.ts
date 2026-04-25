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
 * Write .stellarisrc to project root.
 */
export async function saveStellarisRc(projectRoot: string, rc: StellarisRc): Promise<void> {
  const rcPath = join(projectRoot, RC_FILENAME);
  const lines = [
    '# Stellaris Code Search configuration',
    '# Set auto_index=true to enable automatic incremental indexing on startup',
    `auto_index=${rc.auto_index}`,
  ];

  if (rc.db_connection_string) {
    lines.push('');
    lines.push('# Database schema introspection (connection string stored in plaintext)');
    lines.push(`db_connection_string=${rc.db_connection_string}`);
  }
  if (rc.db_provider && rc.db_provider !== 'auto') {
    lines.push(`db_provider=${rc.db_provider}`);
  }
  if (rc.db_auto_snapshot) {
    lines.push(`db_auto_snapshot=${rc.db_auto_snapshot}`);
  }
  if (rc.db_schemas && rc.db_schemas.length > 0) {
    lines.push(`db_schemas=${rc.db_schemas.join(',')}`);
  }

  lines.push('');
  await writeFile(rcPath, lines.join('\n'), 'utf-8');
}
