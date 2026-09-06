#!/usr/bin/env node
/**
 * Write ~/.grok/hooks/stellaris-reindex.json if Grok is installed.
 * Idempotent. Skips when ~/.grok is missing or no Node 22 runtime is found.
 *
 * Usage: node scripts/install-grok-hook.mjs
 * Env: GROK_HOME (default: ~/.grok), NOVA_NODE
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_FILE = 'stellaris-reindex.json';
const NEED_ABI = '127';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'reindex-file.mjs');
const grokHome = process.env.GROK_HOME || join(homedir(), '.grok');

function shellQuote(p) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function resolveHookNode() {
  const candidates = [
    process.env.NOVA_NODE,
    join(homedir(), '.local', 'bin', 'nova-node'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  if (process.versions.modules === NEED_ABI) return process.execPath;
  return null;
}

if (!existsSync(grokHome)) {
  console.error('[stellaris] no Grok dir — skip hook install:', grokHome);
  process.exit(0);
}

const nodeBin = resolveHookNode();
if (!nodeBin) {
  console.warn(
    `[stellaris] skip Grok hook: need Node 22 (ABI ${NEED_ABI}) to reindex. Install nova-node or run npm install under Node 22.`,
  );
  process.exit(0);
}

if (!existsSync(scriptPath)) {
  console.warn('[stellaris] skip Grok hook: missing', scriptPath);
  process.exit(0);
}

const hooksDir = join(grokHome, 'hooks');
await mkdir(hooksDir, { recursive: true });

const payload = {
  hooks: {
    PostToolUse: [
      {
        matcher: 'write|search_replace|Write|Edit',
        hooks: [
          {
            type: 'command',
            command: `${shellQuote(nodeBin)} ${shellQuote(scriptPath)}`,
            timeout: 30,
          },
        ],
      },
    ],
  },
};

const dest = join(hooksDir, HOOK_FILE);
await writeFile(dest, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
console.error(`[stellaris] Grok hook installed: ${dest}`);
