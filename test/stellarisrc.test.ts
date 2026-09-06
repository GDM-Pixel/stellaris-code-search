/**
 * .stellarisrc save must not wipe alias.* / embedding_* lines.
 * Run with: npx tsx test/stellarisrc.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStellarisRc, saveStellarisRc } from '../src/config/stellarisrc.js';

const dir = await mkdtemp(join(tmpdir(), 'stellaris-rc-'));
await writeFile(
  join(dir, '.stellarisrc'),
  [
    '# Stellaris Code Search configuration',
    '# Set auto_index=true to enable automatic incremental indexing on startup',
    'auto_index=true',
    'embedding_provider=voyage',
    '# QML uses import "Foo.js" (no ./).',
    'alias.Effort.js=plugin/Effort.js',
    'alias.History.js=plugin/History.js',
    '',
  ].join('\n'),
  'utf-8',
);

const rc = await loadStellarisRc(dir);
rc.auto_index = true;
await saveStellarisRc(dir, rc);

const raw = await readFile(join(dir, '.stellarisrc'), 'utf-8');
assert.match(raw, /^auto_index=true$/m, 'auto_index must still be set');
assert.match(raw, /^alias\.Effort\.js=plugin\/Effort\.js$/m, 'QML alias must survive saveStellarisRc');
assert.match(raw, /^alias\.History\.js=plugin\/History\.js$/m, 'sibling alias must survive saveStellarisRc');
assert.match(raw, /^embedding_provider=voyage$/m, 'embedding_provider must survive saveStellarisRc');
console.log('ok  [regression] saveStellarisRc preserves alias.* and embedding_*');
console.log('\nstellarisrc: all assertions passed');
