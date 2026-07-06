/**
 * PHP dependency graph: require_once/include statements must produce edges.
 * Covers the common WordPress patterns (__DIR__ ., dirname(__FILE__) ., bare
 * relative string) and confirms non-local constants (ABSPATH) are skipped.
 * Run with: npx tsx test/php-graph.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports, resetResolverCache } from '../src/graph/resolver.js';
import { extractFileImports } from '../src/indexer/chunker.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'php-graph');
resetResolverCache();

const files = [
  'plugin.php',
  'includes/gemini.php',
  'includes/api/client.php',
  'admin/settings.php',
];

const edgeSet = new Set<string>();
for (const f of files) {
  const content = readFileSync(join(root, f), 'utf-8');
  const raw = extractFileImports(content, '.php');
  for (const r of resolveImports(raw, f, root)) {
    if (r.resolved) edgeSet.add(`${f}=>${r.resolved}`);
  }
}
const edges: Array<[string, string]> = [...edgeSet].map((e) => e.split('=>') as [string, string]);
const depsOf = (s: string) => edges.filter(([x]) => x === s).map(([, t]) => t).sort();
const dependentsOf = (t: string) => edges.filter(([, x]) => x === t).map(([s]) => s).sort();

// __DIR__ . '/...', bare relative, and dirname(__FILE__) . '/...' all resolve.
assert.deepEqual(
  depsOf('plugin.php'),
  ['admin/settings.php', 'includes/api/client.php', 'includes/gemini.php'],
  'plugin.php should require its 3 local files (ABSPATH-based wp-load.php skipped)',
);
console.log('ok  [php] require_once __DIR__ / include / dirname(__FILE__) all resolve');

// ABSPATH . 'wp-load.php' must NOT create an edge (non-local constant).
assert.ok(
  !edges.some(([, t]) => t.includes('wp-load')),
  'ABSPATH-based require must not create an edge',
);
console.log('ok  [php] ABSPATH-based require correctly skipped (no phantom edge)');

// Nested require: gemini.php requires api/client.php → client has 2 dependents.
assert.deepEqual(
  dependentsOf('includes/api/client.php'),
  ['includes/gemini.php', 'plugin.php'],
  'client.php should be depended on by both plugin.php and gemini.php',
);
console.log('ok  [php] nested require chains produce correct reverse edges');

console.log('\nphp-graph: all assertions passed');
