/**
 * Kahn's algorithm for topological ordering of the dependency graph.
 * Files with no dependencies come first (safe to modify first without breaking imports).
 * If cycles exist, returns partial order + the cyclic files separately.
 */

import { DependencyEdge } from './store.js';

export interface TopologicalResult {
  order: string[];
  has_cycles: boolean;
  cyclic_files: string[];
}

/**
 * Compute topological order using Kahn's BFS algorithm.
 * If `files` is provided, only considers the subgraph induced by those files.
 */
export function computeTopologicalOrder(
  edges: DependencyEdge[],
  files?: string[],
): TopologicalResult {
  // Determine the node set
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.source_file);
    allNodes.add(e.target_file);
  }

  const nodeSet = files ? new Set(files) : allNodes;

  // Build adjacency list and in-degree map (restricted to nodeSet)
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodeSet) {
    adj.set(n, []);
    inDegree.set(n, 0);
  }

  for (const e of edges) {
    if (!nodeSet.has(e.source_file) || !nodeSet.has(e.target_file)) continue;
    adj.get(e.source_file)!.push(e.target_file);
    inDegree.set(e.target_file, (inDegree.get(e.target_file) ?? 0) + 1);
  }

  // Kahn's BFS
  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of (adj.get(node) ?? [])) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Nodes not in order are part of cycles
  const orderedSet = new Set(order);
  const cyclic_files = Array.from(nodeSet).filter(n => !orderedSet.has(n));

  return {
    order,
    has_cycles: cyclic_files.length > 0,
    cyclic_files,
  };
}
