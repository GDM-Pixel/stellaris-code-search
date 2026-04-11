/**
 * Tool: get_dead_code
 * Identifies files that are never imported by any other file.
 * Excludes known entry points (index, main, config, test files, etc.).
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { loadMetaIndex } from '../indexer/hasher.js';

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
  /\/__tests__\//,
  /\/tests?\//,
];

function isEntryPoint(filePath: string, extraPatterns: RegExp[]): boolean {
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
    return deg === 0 && !isEntryPoint(f, extraPatterns);
  });

  deadFiles.sort();

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        summary: deadFiles.length === 0
          ? 'No dead code detected (all files are imported by at least one other file).'
          : `Found ${deadFiles.length} unreferenced file(s).`,
        total: deadFiles.length,
        dead_files: deadFiles,
        note: 'Entry points (index, main, config, test, spec files) are excluded. Use exclude_patterns to add custom exclusions.',
      }, null, 2),
    }],
  };
}
