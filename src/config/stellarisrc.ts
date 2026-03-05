import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RC_FILENAME = '.stellarisrc';

export interface StellarisRc {
  auto_index: boolean;
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
    if (key === 'auto_index') {
      result.auto_index = value === 'true';
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
  const content = [
    '# Stellaris Code Search configuration',
    '# Set auto_index=true to enable automatic incremental indexing on startup',
    `auto_index=${rc.auto_index}`,
    '',
  ].join('\n');
  await writeFile(rcPath, content, 'utf-8');
}
