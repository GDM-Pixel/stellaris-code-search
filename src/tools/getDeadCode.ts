/**
 * Tool: get_dead_code
 * Identifies files that are never imported by any other file.
 * Excludes known entry points (index, main, config, test files, etc.).
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { loadMetaIndex } from '../indexer/hasher.js';
import { truncateIfOversized } from '../utils/responseTier.js';

/** Extensions that are never imported via JS/TS import statements — always in_degree 0, not dead code */
export const NON_IMPORTABLE_EXTENSIONS = new Set([
  '.css', '.scss', '.less', '.sass',
  '.html', '.htm',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx', '.txt', '.rst',
  '.sql', '.graphql', '.gql', '.prisma',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.env', '.env.local', '.env.production',
  '.lock',
]);

const DEFAULT_ENTRY_PATTERNS = [
  /^index\.[a-z]+$/i,
  /\/index\.[a-z]+$/i,
  /^main\.[a-z]+$/i,
  /\/main\.[a-z]+$/i,
  /^App\.[a-z]+$/i,
  /\/App\.[a-z]+$/i,
  /\.config\.[a-z]+$/i,
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /\.stories\.[a-z]+$/i,
  /\.d\.ts$/i,
  /\/__tests__\//,
  /\/tests?\//,
];

export function isEntryPoint(filePath: string, extraPatterns: RegExp[] = []): boolean {
  const all = [...DEFAULT_ENTRY_PATTERNS, ...extraPatterns];
  return all.some(p => p.test(filePath));
}

export async function handleGetDeadCode(args: Record<string, unknown>) {
  const excludePatterns: string[] = Array.isArray(args.exclude_patterns)
    ? (args.exclude_patterns as string[])
    : [];

  const projectRoot = findProjectRoot(process.cwd());

  if (!(await hasGraph(projectRoot))) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NO_GRAPH',
          message: 'No dependency graph found. Please run reindex first.',
        }, null, 2),
      }],
      isError: true,
    };
  }

  const [edges, meta] = await Promise.all([
    getAllEdges(projectRoot),
    loadMetaIndex(projectRoot),
  ]);

  // Compute in-degree for all files
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    inDegree.set(e.target_file, (inDegree.get(e.target_file) ?? 0) + 1);
  }

  // All indexed files
  const allFiles = Object.keys(meta);
  const extraPatterns = excludePatterns.map(p => {
    try { return new RegExp(p); } catch { return null; }
  }).filter(Boolean) as RegExp[];

  const deadFiles = allFiles.filter(f => {
    const deg = inDegree.get(f) ?? 0;
    if (deg > 0) return false;
    // Skip non-importable files (CSS, JSON, images, etc.) — they always have 0 in-degree
    const ext = f.substring(f.lastIndexOf('.'));
    if (NON_IMPORTABLE_EXTENSIONS.has(ext)) return false;
    return !isEntryPoint(f, extraPatterns);
  });

  deadFiles.sort();

  const payload = truncateIfOversized({
    summary: deadFiles.length === 0
      ? 'No dead code detected (all files are imported by at least one other file).'
      : `Found ${deadFiles.length} unreferenced file(s).`,
    total: deadFiles.length,
    dead_files: deadFiles,
    note: 'Entry points (index, main, config, test, spec files) are excluded. Use exclude_patterns to add custom exclusions.',
  }, ['dead_files']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}
