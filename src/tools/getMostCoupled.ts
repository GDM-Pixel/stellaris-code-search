/**
 * Tool: get_most_coupled
 * Returns the most highly coupled files (highest combined in-degree + out-degree).
 * These are prime candidates for extraction into smaller, focused modules.
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { truncateIfOversized } from '../utils/responseTier.js';

export async function handleGetMostCoupled(args: Record<string, unknown>) {
  const top = typeof args.top === 'number' ? Math.max(1, Math.min(args.top, 100)) : 10;
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

  const edges = await getAllEdges(projectRoot);

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const consumers = new Map<string, string[]>();
  const nodeSet = new Set<string>();

  for (const e of edges) {
    nodeSet.add(e.source_file);
    nodeSet.add(e.target_file);
    outDegree.set(e.source_file, (outDegree.get(e.source_file) ?? 0) + 1);
    inDegree.set(e.target_file, (inDegree.get(e.target_file) ?? 0) + 1);
    if (!consumers.has(e.target_file)) consumers.set(e.target_file, []);
    consumers.get(e.target_file)!.push(e.source_file);
  }

  const ranked = Array.from(nodeSet)
    .map(f => ({
      path: f,
      in_degree: inDegree.get(f) ?? 0,
      out_degree: outDegree.get(f) ?? 0,
      total: (inDegree.get(f) ?? 0) + (outDegree.get(f) ?? 0),
      consumers: consumers.get(f) ?? [],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);

  const payload = truncateIfOversized({
    summary: `Top ${ranked.length} most coupled file(s) by total dependencies (in + out).`,
    files: ranked,
    note: 'High in-degree = many files depend on this. High out-degree = this file depends on many others. Both signal coupling risk.',
  }, ['files']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}
