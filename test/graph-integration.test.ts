/**
 * End-to-end check: simulate the reindex graph-build loop over the monorepo
 * fixture and assert get_dependents-style queries return the real importers.
 * Run with: npx tsx test/graph-integration.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports, resetResolverCache } from '../src/graph/resolver.js';
import { extractFileImports } from '../src/indexer/chunker.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'monorepo');
resetResolverCache();

const files = [
  'nova-chat/src/components/Chat.tsx',
  'nova-chat/src/components/ui/index.ts',
  'nova-chat/src/components/ui/ConfirmDialog.tsx',
  'nova-chat/src/services/todoist.ts',
];

// Model the real graph store: PRIMARY KEY (source_file, target_file) collapses
// duplicate edges (e.g. a barrel that both `export {X} from` and `export * from`).
const edgeSet = new Set<string>();
for (const f of files) {
  const content = readFileSync(join(root, f), 'utf-8');
  const raw = extractFileImports(content, '.' + f.split('.').pop());
  for (const r of resolveImports(raw, f, root)) {
    if (r.resolved) edgeSet.add(`${f}=>${r.resolved}`);
  }
}
const edges: Array<[string, string]> = [...edgeSet].map(e => e.split('=>') as [string, string]);

const dependentsOf = (t: string) => edges.filter(([, x]) => x === t).map(([s]) => s).sort();

// ConfirmDialog is reached via the barrel re-export — was 0 dependents before fix.
assert.deepEqual(
  dependentsOf('nova-chat/src/components/ui/ConfirmDialog.tsx'),
  ['nova-chat/src/components/ui/index.ts'],
  'ConfirmDialog should be depended on by its barrel index',
);

// todoist service is imported by Chat via @/ alias — was 0 dependents before fix.
assert.deepEqual(
  dependentsOf('nova-chat/src/services/todoist.ts'),
  ['nova-chat/src/components/Chat.tsx'],
  'todoist service should be depended on by Chat.tsx',
);

// The barrel itself depends on ConfirmDialog (outgoing re-export edge).
assert.ok(
  edges.some(([s, t]) =>
    s === 'nova-chat/src/components/ui/index.ts' &&
    t === 'nova-chat/src/components/ui/ConfirmDialog.tsx'),
  'barrel index.ts should have an outgoing edge to ConfirmDialog',
);

// Chat->todoist, Chat->ui/index, ui/index->ConfirmDialog
assert.ok(edges.length >= 3, `expected >=3 unique edges, got ${edges.length}: ${edges.join(', ')}`);

console.log('graph-integration: all assertions passed');
console.log('edges:');
for (const [s, t] of edges.sort()) console.log(`  ${s} => ${t}`);
