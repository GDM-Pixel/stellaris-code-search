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

  // Tarjan's SCC — iterative (no recursion, safe on large graphs).
  // Each work-stack frame: [node, neighborIndex] where neighborIndex tracks
  // how far through the neighbor list we've processed (resumes after tree edges).
  const nodes = Array.from(nodeSet);
  const index   = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const sccStack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    const work: Array<[string, number]> = [[root, 0]];
    index.set(root, counter);
    lowlink.set(root, counter);
    counter++;
    sccStack.push(root);
    onStack.set(root, true);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame[0];
      const neighbors = adj.get(v) ?? [];

      if (frame[1] < neighbors.length) {
        const w = neighbors[frame[1]++];
        if (!index.has(w)) {
          // Tree edge — visit w (pre-order)
          index.set(w, counter);
          lowlink.set(w, counter);
          counter++;
          sccStack.push(w);
          onStack.set(w, true);
          work.push([w, 0]);
        } else if (onStack.get(w)) {
          // Back edge — update lowlink immediately
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      } else {
        // Post-order: all neighbors of v processed
        work.pop();
        if (work.length > 0) {
          // Propagate lowlink to parent (mirrors the post-recursive update)
          const parent = work[work.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
        }
        // Root of an SCC?
        if (lowlink.get(v) === index.get(v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = sccStack.pop()!;
            onStack.set(w, false);
            scc.push(w);
          } while (w !== v);
          sccs.push(scc);
        }
      }
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
