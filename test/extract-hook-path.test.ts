/**
 * Run with: npx tsx test/extract-hook-path.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEditedPath, resolveEditedPath } from '../scripts/extract-hook-path.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..');

assert.equal(
  extractEditedPath({ toolInput: { file_path: '/tmp/plugin/Overlay.qml' } }),
  '/tmp/plugin/Overlay.qml',
  'Grok camelCase toolInput',
);
assert.equal(
  extractEditedPath({ tool_input: { file_path: '/tmp/a.ts' } }),
  '/tmp/a.ts',
  'Claude snake_case tool_input',
);
assert.equal(
  extractEditedPath({ toolInput: { filePath: '/tmp/b.ts' } }),
  '/tmp/b.ts',
);
assert.equal(
  extractEditedPath({ toolInput: {} }, '/tmp/from-argv.ts'),
  '/tmp/from-argv.ts',
);
assert.equal(extractEditedPath({ toolInput: {} }), null);
assert.equal(
  resolveEditedPath('plugin/Foo.qml', { cwd: '/home/charles/Projects/Novarchy' }),
  '/home/charles/Projects/Novarchy/plugin/Foo.qml',
);
console.log('ok  extractEditedPath / resolveEditedPath');

const grokHome = await mkdtemp(join(tmpdir(), 'stellaris-grok-'));
await mkdir(join(grokHome, 'hooks'), { recursive: true });
const r = spawnSync(process.execPath, [join(repo, 'scripts/install-grok-hook.mjs')], {
  env: { ...process.env, GROK_HOME: grokHome, NOVA_NODE: process.execPath },
  encoding: 'utf-8',
});
assert.equal(r.status, 0, `install-grok-hook failed: ${r.stderr}`);
const hook = JSON.parse(await readFile(join(grokHome, 'hooks/stellaris-reindex.json'), 'utf-8'));
assert.equal(hook.hooks.PostToolUse[0].matcher, 'write|search_replace|Write|Edit');
assert.match(hook.hooks.PostToolUse[0].hooks[0].command, /reindex-file\.mjs/);
assert.equal(hook.hooks.PostToolUse[0].hooks[0].timeout, 30);
console.log('ok  install-grok-hook writes ~/.grok/hooks/stellaris-reindex.json');

console.log('\nhook-path: all assertions passed');
