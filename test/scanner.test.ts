/**
 * Regression: a project whose code lives at the root (PHP/WordPress plugin,
 * or any repo without a src/ dir) must have its code files scanned.
 * Before the fix, DEFAULT_INCLUDE = ['src/**', ...] scanned 0 code files here.
 * Run with: npx tsx test/scanner.test.ts
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/loader.js';
import { scanFiles } from '../src/indexer/scanner.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'php-plugin');

const config = await loadConfig(root);
const files = await scanFiles(root, config);
const rels = files.map((f) => f.relativePath).sort();
const code = files.filter((f) => f.category === 'code').map((f) => f.relativePath).sort();

// PHP at the root AND in nested non-src dirs must be indexed.
assert.ok(code.includes('my-plugin.php'), 'root-level PHP must be scanned');
assert.ok(code.includes('includes/gemini.php'), 'PHP in includes/ must be scanned');
assert.ok(code.includes('admin/settings.php'), 'PHP in admin/ must be scanned');
console.log('ok  [regression] root-level and nested PHP is scanned');

// vendor/ must NOT be indexed (dependency dir).
assert.ok(
  !rels.some((r) => r.startsWith('vendor/')),
  `vendor/ must be excluded, got: ${rels.filter((r) => r.startsWith('vendor/')).join(', ')}`,
);
console.log('ok  [regression] vendor/ dependency dir is excluded');

// At least the 3 real PHP source files (not the vendor one).
assert.equal(code.length, 3, `expected 3 code files, got ${code.length}: ${code.join(', ')}`);
console.log('ok  [regression] exactly the 3 real PHP source files scanned');

console.log('\nscanner: all assertions passed');
