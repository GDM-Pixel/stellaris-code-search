#!/usr/bin/env node
/**
 * Stellaris auto-reindex hook.
 * Grok PostToolUse: JSON on stdin (toolInput.file_path).
 * Claude PostToolUse: argv path and/or tool_input.file_path on stdin.
 *
 * Must run under Node 22 (nova-node, ABI 127) — this imports better-sqlite3.
 * Only runs if the project already has .vectors/meta.json.
 */
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { extractEditedPath, resolveEditedPath } from './extract-hook-path.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8').trim();
}

function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.vectors', 'meta.json'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return resolve(startPath);
}

const stdinRaw = await readStdin();
let event = null;
if (stdinRaw) {
  try {
    event = JSON.parse(stdinRaw);
  } catch {
    // not JSON — ignore
  }
}

const rawPath = extractEditedPath(event, process.argv[2]);
const absolutePath = resolveEditedPath(rawPath, event);
if (!absolutePath) process.exit(0);

const projectRoot = findProjectRoot(absolutePath);
const metaPath = join(projectRoot, '.vectors', 'meta.json');
if (!existsSync(metaPath)) process.exit(0);

if (!existsSync(absolutePath)) {
  // Deletion: still let handleReindexFile drop the file from the index.
} else {
  let supported = null;
  try {
    const { SUPPORTED_EXTENSIONS } = await import('../dist/config/defaults.js');
    const ext = extname(absolutePath).toLowerCase();
    supported = new Set([...SUPPORTED_EXTENSIONS.code, ...SUPPORTED_EXTENSIONS.docs]);
    if (!supported.has(ext)) process.exit(0);
  } catch {
    // dist missing — still try the handler
  }
}

try {
  const { handleReindexFile } = await import('../dist/tools/reindex.js');
  const result = await handleReindexFile({ file: absolutePath });
  const text = result.content?.[0]?.text ?? '';
  if (result.isError) {
    process.stderr.write(`[Stellaris] reindex-file error: ${text}\n`);
  } else {
    process.stderr.write(`[Stellaris] reindex-file: ${text}\n`);
  }
} catch (err) {
  process.stderr.write(`[Stellaris] reindex-file failed: ${err?.message ?? err}\n`);
}
process.exit(0);
