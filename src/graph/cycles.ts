/**
 * Tarjan's Strongly Connected Components algorithm for cycle detection.
 * A cycle exists when an SCC has size > 1, or when a node has a self-edge.
 */

import { DependencyEdge } from './store.js';

export interface CycleGroup {
  files: string[];
  edges: { from: string; to: string }[];
}

/**
 * Detect all cycles in the dependency graph using Tarjan's SCC algorithm.
 * Returns groups of files that form circular dependency cycles.
 */
export function detectCycles(edges: DependencyEdge[]): CycleGroup[] {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  const nodeSet = new Set<string>();

  for (const e of edges) {
    nodeSet.add(e.source_file);
    nodeSet.add(e.target_file);
    if (!adj.has(e.source_file)) adj.set(e.source_file, []);
    adj.get(e.source_file)!.push(e.target_file);
  }

  // Tarjan's algorithm
  const nodes = Array.from(nodeSet);
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  function strongConnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = adj.get(v) ?? [];
    for (const w of neighbors) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    // If v is a root node, pop the SCC
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const node of nodes) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }

  // Filter SCCs with size > 1 (actual cycles)
  const cycles: CycleGroup[] = [];
  for (const scc of sccs) {
    if (scc.length < 2) continue;

    const fileSet = new Set(scc);
    const cycleEdges: { from: string; to: string }[] = [];
    for (const f of scc) {
      for (const neighbor of (adj.get(f) ?? [])) {
        if (fileSet.has(neighbor)) {
          cycleEdges.push({ from: f, to: neighbor });
        }
      }
    }

    cycles.push({ files: scc, edges: cycleEdges });
  }

  // Also detect self-edges
  for (const e of edges) {
    if (e.source_file === e.target_file) {
      cycles.push({ files: [e.source_file], edges: [{ from: e.source_file, to: e.target_file }] });
    }
  }

  return cycles;
}
