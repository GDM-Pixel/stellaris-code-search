/**
 * Tool: get_circular_deps
 * Detects circular dependencies in the project using Tarjan's SCC algorithm.
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { detectCycles } from '../graph/cycles.js';
import { truncateIfOversized } from '../utils/responseTier.js';

export async function handleGetCircularDeps(args: Record<string, unknown>) {
  const maxCycles = typeof args.max_cycles === 'number' ? args.max_cycles : 50;
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
  const cycles = detectCycles(edges);
  const shown = cycles.slice(0, maxCycles);

  const summary = cycles.length === 0
    ? 'No circular dependencies detected.'
    : `Found ${cycles.length} circular dependency group(s).${cycles.length > maxCycles ? ` Showing first ${maxCycles}.` : ''}`;

  const payload = truncateIfOversized({
    summary,
    total_cycles: cycles.length,
    cycles: shown.map((c, i) => ({
      cycle_id: i + 1,
      files: c.files,
      edges: c.edges,
    })),
  }, ['cycles']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}
