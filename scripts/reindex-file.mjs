#!/usr/bin/env node
/**
 * Stellaris auto-reindex hook script.
 * Called by Claude Code PostToolUse hooks after Write/Edit.
 * Usage: node reindex-file.mjs <absolute-file-path>
 *
 * Only runs if the project has a .vectors/meta.json (already indexed).
 */

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const filePath = process.argv[2];
if (!filePath) process.exit(0);

const absolutePath = resolve(filePath).replace(/\\/g, '/');

// Find project root
function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = resolve(dir, '..');
  }
  return resolve(startPath);
}

const projectRoot = findProjectRoot(absolutePath);
const metaPath = join(projectRoot, '.vectors', 'meta.json');

// Only run if project is already indexed
if (!existsSync(metaPath)) process.exit(0);

// Dynamically import the compiled handler
const { handleReindexFile } = await import('../dist/tools/reindex.js');

const result = await handleReindexFile({ file: absolutePath });
const text = result.content?.[0]?.text ?? '';

// Print to stderr so it appears in Claude Code output
if (result.isError) {
  process.stderr.write(`[Stellaris] reindex-file error: ${text}\n`);
} else {
  process.stderr.write(`[Stellaris] reindex-file: ${text}\n`);
}
