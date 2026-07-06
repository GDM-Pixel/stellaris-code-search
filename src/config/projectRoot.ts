/**
 * Single source of truth for resolving a project's root directory.
 *
 * The MCP server never guesses silently: root resolution is deterministic and
 * predictable. When the situation is ambiguous (no index, no marker at the
 * start dir, but nested projects exist), detectNestedProjects() surfaces the
 * candidates so the calling agent can decide — it is never used to pick a root.
 *
 * See docs/superpowers/specs/2026-07-06-project-root-detection-design.md
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Files/dirs whose presence marks a directory as a project root. */
const PROJECT_MARKERS = [
  '.git',
  'composer.json',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
];

/** Directories never treated as nested projects (dependency/build/system dirs). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vectors',
  'vendor',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  'out',
  'coverage',
]);

function hasMarker(dir: string): boolean {
  return PROJECT_MARKERS.some((m) => existsSync(join(dir, m)));
}

/**
 * A directory counts as "already indexed" only if its .vectors/ holds a real
 * index artefact (meta.json or graph.db) — not merely a stray .vectors/ that
 * some side channel (e.g. a usage log) may have created. This keeps root
 * resolution anchored on genuinely-indexed projects.
 */
function hasVectors(dir: string): boolean {
  const v = join(dir, '.vectors');
  if (!existsSync(v)) return false;
  return existsSync(join(v, 'meta.json')) || existsSync(join(v, 'graph.db'));
}

/**
 * Resolve the project root, deterministically. First match wins:
 *   1. explicitPath, if provided (e.g. reindex's `path` argument)
 *   2. an existing .vectors/ at startDir (already indexed here — stay consistent)
 *   3. the nearest project marker walking up from startDir toward the FS root
 *   4. startDir itself (last resort)
 *
 * Never throws: filesystem checks that fail fall through to the next step.
 */
export function resolveProjectRoot(startDir: string = process.cwd(), explicitPath?: string): string {
  if (explicitPath) return resolve(explicitPath);

  const start = resolve(startDir);

  // 2. Already indexed here.
  if (hasVectors(start)) return start;

  // 3. Nearest marker walking up.
  let dir = start;
  while (dir !== resolve(dir, '..')) {
    if (hasMarker(dir)) return dir;
    dir = resolve(dir, '..');
  }

  // 4. Fallback.
  return start;
}

/**
 * List depth-1 subdirectories of startDir that look like standalone projects.
 * Returns [] when startDir itself has a .vectors/ or a project marker (no
 * ambiguity to report). Used to enrich NO_GRAPH messages — never to pick a root.
 */
export function detectNestedProjects(startDir: string = process.cwd()): string[] {
  const start = resolve(startDir);

  // If startDir is itself indexed or a project, there is nothing ambiguous.
  if (hasVectors(start) || hasMarker(start)) return [];

  let entries;
  try {
    entries = readdirSync(start, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    if (hasMarker(join(start, entry.name))) {
      nested.push(entry.name);
    }
  }
  return nested;
}

/**
 * Backward-compatible façade. ~28 modules import findProjectRoot from
 * ../indexer/scanner.js; scanner.ts re-exports this so those imports keep
 * working while the canonical implementation lives here.
 */
export function findProjectRoot(startPath: string): string {
  return resolveProjectRoot(startPath);
}

/**
 * Build a NO_GRAPH error payload, enriched with nested-project hints when the
 * current directory looks like it contains standalone sub-projects (the common
 * "MCP started one level above the actual project" case). Returned as a plain
 * object; callers wrap it in the MCP content envelope.
 */
export function noGraphError(projectRoot: string): {
  error: string;
  message: string;
  nested_projects?: string[];
} {
  const nested = detectNestedProjects(projectRoot);
  if (nested.length === 0) {
    return {
      error: 'NO_GRAPH',
      message: 'No dependency graph found. Please run reindex first to build the graph.',
    };
  }
  const first = nested[0];
  return {
    error: 'NO_GRAPH',
    message:
      `No dependency graph at ${projectRoot}. Nested project(s) detected: ${nested.join(', ')}. ` +
      `Run reindex with path="${join(projectRoot, first)}", or restart Stellaris from that directory.`,
    nested_projects: nested,
  };
}
