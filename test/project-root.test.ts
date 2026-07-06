/**
 * Project root resolution: deterministic cascade + nested-project detection.
 * Regression for the NO_GRAPH bug on nested projects (WordPress plugin under a
 * markerless parent dir).
 * Run with: npx tsx test/project-root.test.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectRoot, detectNestedProjects, noGraphError } from '../src/config/projectRoot.js';

const TMP = join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-project-root');
rmSync(TMP, { recursive: true, force: true });

function mk(rel: string, marker?: string) {
  const dir = join(TMP, rel);
  mkdirSync(dir, { recursive: true });
  if (marker) writeFileSync(join(dir, marker), '');
  return dir;
}

// 1. explicitPath wins over everything.
assert.equal(resolveProjectRoot(TMP, '/somewhere/else'), '/somewhere/else', 'explicitPath should win');
console.log('ok  explicitPath takes priority');

// 2. A real .vectors/ (with an index artefact) at startDir wins over a parent marker.
{
  const parent = mk('case2', '.git');
  const child = mk('case2/app');
  mkdirSync(join(child, '.vectors'), { recursive: true });
  writeFileSync(join(child, '.vectors', 'meta.json'), '{}'); // real index artefact
  assert.equal(resolveProjectRoot(child), child, 'indexed .vectors/ should anchor here, not the parent .git');
}
console.log('ok  indexed .vectors/ at startDir wins');

// 2b. An empty .vectors/ (no meta.json/graph.db) must NOT count — it should fall
// through to the parent marker. Guards against stray .vectors/ (e.g. logger-only).
{
  const parent = mk('case2b', '.git');
  const child = mk('case2b/app');
  mkdirSync(join(child, '.vectors'), { recursive: true }); // empty, no artefact
  assert.equal(resolveProjectRoot(child), join(TMP, 'case2b'), 'empty .vectors/ must not anchor; walk up to parent marker');
}
console.log('ok  empty .vectors/ does not anchor (falls through to marker)');

// 3. nearest marker walking up.
{
  mk('case3', 'composer.json');
  const sub = mk('case3/deep/nested');
  assert.equal(resolveProjectRoot(sub), join(TMP, 'case3'), 'should walk up to nearest composer.json');
}
console.log('ok  nearest marker walking up');

// 4. fallback to startDir when nothing found.
{
  const bare = mk('case4/bare/dir');
  // No marker anywhere under TMP/case4 — but TMP's ancestors may have .git (the
  // stellaris repo). Use a marker-free chain and assert it does NOT invent one
  // below startDir; walking up may hit the real repo root, so just assert it's
  // an ancestor-or-self, never a descendant.
  const resolved = resolveProjectRoot(bare);
  assert.ok(bare.startsWith(resolved), 'fallback must be startDir or an ancestor, never a descendant');
}
console.log('ok  fallback stays at startDir or an ancestor');

// 5. non-regression: .git directly at startDir → startDir.
{
  const repo = mk('case5', '.git');
  assert.equal(resolveProjectRoot(repo), repo, 'a dir with its own .git resolves to itself');
}
console.log('ok  dir with own .git resolves to itself');

// 6. detectNestedProjects — the aaia-chat case.
{
  const parent = mk('case6'); // no marker, no .vectors
  mk('case6/plugin', 'composer.json');
  mk('case6/plugin', '.git');
  mk('case6/node_modules', 'package.json'); // must be skipped
  const nested = detectNestedProjects(parent);
  assert.deepEqual(nested, ['plugin'], 'should detect plugin/, skip node_modules/');
}
console.log('ok  detectNestedProjects finds nested project, skips dep dirs');

// 7. detectNestedProjects — no ambiguity when startDir is itself a project.
{
  const proj = mk('case7', 'package.json');
  mk('case7/sub', 'composer.json');
  assert.deepEqual(detectNestedProjects(proj), [], 'no ambiguity when startDir has a marker');
}
console.log('ok  detectNestedProjects returns [] when startDir is a project');

// 8. noGraphError enrichment.
{
  const parent = mk('case8');
  mk('case8/plugin', '.git');
  const err = noGraphError(parent);
  assert.equal(err.error, 'NO_GRAPH');
  assert.deepEqual(err.nested_projects, ['plugin'], 'nested projects surfaced in error');
  assert.ok(err.message.includes('plugin'), 'message mentions the nested project');

  const plain = noGraphError(mk('case8b', 'package.json'));
  assert.equal(plain.nested_projects, undefined, 'no nested_projects field when unambiguous');
}
console.log('ok  noGraphError enriches only when ambiguous');

rmSync(TMP, { recursive: true, force: true });
console.log('\nproject-root: all assertions passed');
