#!/usr/bin/env node
/**
 * Stellaris SessionStart hook script.
 * Invoked by Claude Code on session start to inject a project briefing.
 * Writes briefing to stdout (captured as additional context by Claude Code).
 *
 * Activation (in ~/.claude/settings.json):
 *   "hooks": {
 *     "SessionStart": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/stellaris/scripts/session-start.mjs" }]
 *     }]
 *   }
 *
 * Degrades gracefully: no graph yet, no git history, or Stellaris not built — emits nothing.
 * Global timeout ≈ 3s.
 */

import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_BRIEFING = resolve(__dirname, '..', 'dist', 'tools', 'sessionBriefing.js');
const DIST_BRIEFING_URL = pathToFileURL(DIST_BRIEFING).href;

// Silently exit if Stellaris hasn't been built
if (!existsSync(DIST_BRIEFING)) process.exit(0);

// Find project root from cwd
function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = resolve(dir, '..');
  }
  return resolve(startPath);
}

const projectRoot = findProjectRoot(process.cwd());
// Only brief if this looks like a real project (has git)
if (!existsSync(join(projectRoot, '.git'))) process.exit(0);

// Enforce a 3s timeout globally
const timeoutId = setTimeout(() => {
  process.stderr.write('[Stellaris] session-start: timeout (>3s), skipping briefing\n');
  process.exit(0);
}, 3000);

try {
  const { handleSessionBriefing } = await import(DIST_BRIEFING_URL);
  const result = await handleSessionBriefing({ days: 7, max_recent_files: 8, format: 'markdown' });
  const text = result.content?.[0]?.text ?? '';

  if (text.trim().length > 0) {
    // stdout is captured by Claude Code SessionStart hooks and injected into context
    process.stdout.write(`# Stellaris Project Briefing\n\n${text}\n`);
  }
} catch (err) {
  process.stderr.write(`[Stellaris] session-start error: ${err.message}\n`);
} finally {
  clearTimeout(timeoutId);
}
