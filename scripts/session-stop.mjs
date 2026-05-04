#!/usr/bin/env node
/**
 * Stellaris Stop/SessionEnd hook script.
 * Invoked by Claude Code at session end to detect significant technical changes
 * and nudge the model to memorize via nova-mind-cloud storeMemory.
 *
 * Activation (in ~/.claude/settings.json):
 *   "hooks": {
 *     "Stop": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/stellaris/scripts/session-stop.mjs" }]
 *     }]
 *   }
 *
 * Behavior:
 *   - Calls `detect_significant_changes` handler (git diff vs HEAD).
 *   - If significant, emits a structured reminder on stdout so Claude Code injects it.
 *   - Never blocks. Never calls storeMemory itself — only prompts the AI to do it.
 *   - Timeout ≈ 2s.
 */

import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DETECT = resolve(__dirname, '..', 'dist', 'tools', 'detectSignificantChanges.js');
const DIST_DETECT_URL = pathToFileURL(DIST_DETECT).href;

if (!existsSync(DIST_DETECT)) process.exit(0);

function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = resolve(dir, '..');
  }
  return resolve(startPath);
}

const projectRoot = findProjectRoot(process.cwd());
if (!existsSync(join(projectRoot, '.git'))) process.exit(0);

const timeoutId = setTimeout(() => process.exit(0), 2000);

try {
  const { handleDetectSignificantChanges } = await import(DIST_DETECT_URL);
  const result = await handleDetectSignificantChanges({});
  const text = result.content?.[0]?.text ?? '{}';
  const data = JSON.parse(text);

  if (data.significant) {
    // Emit a structured reminder. Claude Code captures stdout from Stop hooks.
    const summary = [
      `# 🧠 Stellaris — Significant session detected`,
      ``,
      `Signals:`,
      ...data.signals.map((s) => `- ${s}`),
      ``,
      `Stats: ${data.stats.lines_changed} lines across ${data.stats.files_changed} files` +
        (data.stats.cycles_count ? ` · ${data.stats.cycles_count} cycles in graph` : ''),
      ``,
      data.recommendation,
      ``,
      `Files touched: ${data.stats.touched_files.join(', ')}`,
    ].join('\n');
    process.stdout.write(summary + '\n');
  }
} catch (err) {
  process.stderr.write(`[Stellaris] session-stop error: ${err.message}\n`);
} finally {
  clearTimeout(timeoutId);
}
