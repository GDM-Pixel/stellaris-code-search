/**
 * Resolver test suite. Run with: npx tsx test/resolver.test.ts
 *
 * Covers the import-resolution + dependency-graph bugs:
 *  - tsconfig nearest the source file (monorepo subdir), not just projectRoot
 *  - tsconfig `extends` chain (baseUrl in base, paths in child)
 *  - paths/baseUrl resolved relative to the tsconfig's own directory
 *  - Vite resolve.alias fallback when no tsconfig paths
 *  - .stellarisrc manual alias override
 *  - re-export / barrel edges (export { X } from './X')
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImports, resetResolverCache } from '../src/graph/resolver.js';
import { extractFileImports } from '../src/indexer/chunker.js';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`FAIL  ${name}`);
      console.log(`      ${err.message}`);
    });
}

function resolvedMap(root: string, sourceRel: string) {
  resetResolverCache();
  const abs = join(root, sourceRel);
  const content = readFileSync(abs, 'utf-8');
  const ext = '.' + sourceRel.split('.').pop();
  const raw = extractFileImports(content, ext);
  const resolved = resolveImports(raw, sourceRel, root);
  const map = new Map<string, string | null>();
  for (const r of resolved) map.set(r.raw, r.resolved);
  return map;
}

async function main() {
  const monorepo = join(FIXTURES, 'monorepo');
  const viteproj = join(FIXTURES, 'viteproj');
  const rcproj = join(FIXTURES, 'rcproj');

  // Bug 1+2+3: alias resolved via tsconfig nearest the source (nova-chat/), with
  // extends chain (baseUrl in tsconfig.base.json) and paths relative to tsconfig dir.
  await test('resolves @/ alias via nearest tsconfig in a monorepo subdir', () => {
    const m = resolvedMap(monorepo, 'nova-chat/src/components/Chat.tsx');
    assert.equal(
      m.get('@/services/todoist'),
      'nova-chat/src/services/todoist.ts',
      'expected @/services/todoist to resolve into nova-chat/src',
    );
  });

  // Bug 4: barrel import target resolves to the index file...
  await test('resolves alias import that points at a barrel index', () => {
    const m = resolvedMap(monorepo, 'nova-chat/src/components/Chat.tsx');
    assert.equal(
      m.get('@/components/ui'),
      'nova-chat/src/components/ui/index.ts',
    );
  });

  // Bug 4: ...and the barrel's own re-exports create outgoing edges.
  await test('barrel re-export (export { X } from) is extracted as an import', () => {
    const content = readFileSync(
      join(monorepo, 'nova-chat/src/components/ui/index.ts'),
      'utf-8',
    );
    const raw = extractFileImports(content, '.ts');
    assert.ok(
      raw.includes('./ConfirmDialog'),
      `expected re-export './ConfirmDialog' to be extracted, got: ${JSON.stringify(raw)}`,
    );
  });

  await test('barrel re-export resolves to the real file (edge target)', () => {
    resetResolverCache();
    const resolved = resolveImports(
      ['./ConfirmDialog'],
      'nova-chat/src/components/ui/index.ts',
      monorepo,
    );
    assert.equal(
      resolved[0]?.resolved,
      'nova-chat/src/components/ui/ConfirmDialog.tsx',
    );
  });

  // Vite resolve.alias fallback (no tsconfig paths present).
  await test('falls back to vite resolve.alias when no tsconfig paths', () => {
    const m = resolvedMap(viteproj, 'src/app/main.ts');
    assert.equal(m.get('@/lib/utils'), 'src/lib/utils.ts');
    assert.equal(m.get('~lib/utils'), 'src/lib/utils.ts');
  });

  // .stellarisrc manual alias override (no tsconfig, no vite config).
  await test('honors .stellarisrc alias.* override', () => {
    const m = resolvedMap(rcproj, 'source/main/app.ts');
    assert.equal(m.get('@/helpers/format'), 'source/helpers/format.ts');
    assert.equal(m.get('#utils/format'), 'source/helpers/format.ts');
  });

  // --- Regression: pre-existing behavior must still work ---
  const classic = join(FIXTURES, 'classic');

  await test('[regression] relative ./auth resolves within same dir', () => {
    // src/utils/auth.ts imported from src/utils/index.ts
    resetResolverCache();
    const r = resolveImports(['./auth'], 'src/utils/index.ts', classic);
    assert.equal(r[0]?.resolved, 'src/utils/auth.ts');
  });

  await test('[regression] root tsconfig @/* alias still resolves', () => {
    const m = resolvedMap(classic, 'src/api/main.ts');
    assert.equal(m.get('@/api/client'), 'src/api/client.ts');
  });

  await test('[regression] ../ + .js extension remaps to .ts', () => {
    const m = resolvedMap(classic, 'src/api/main.ts');
    assert.equal(m.get('../utils/auth.js'), 'src/utils/auth.ts');
  });

  await test('[regression] directory import "./" resolves to index.ts', () => {
    // src/utils has an index.ts, imported as "./" from a sibling-style path
    resetResolverCache();
    const r = resolveImports(['.'], 'src/utils/auth.ts', classic);
    assert.equal(r[0]?.resolved, 'src/utils/index.ts');
  });

  await test('[regression] npm packages and node builtins are skipped', () => {
    const m = resolvedMap(classic, 'src/api/main.ts');
    assert.equal(m.has('react'), false, 'bare npm specifier must be filtered out');
    assert.equal(m.has('node:fs'), false, 'node builtin must be filtered out');
  });

  await test('[regression] @/ and ~/ convention fallback works with no config', () => {
    const noconfig = join(FIXTURES, 'noconfig');
    const m = resolvedMap(noconfig, 'src/pages/Home.ts');
    assert.equal(m.get('@/widgets/Button'), 'src/widgets/Button.ts');
    assert.equal(m.get('~/widgets/Button'), 'src/widgets/Button.ts');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
