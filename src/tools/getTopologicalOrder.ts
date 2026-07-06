/**
 * Tool: get_topological_order
 * Returns files in dependency order (dependencies before dependents).
 * Useful to determine the safe order to modify files without breaking intermediate builds.
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { noGraphError } from '../config/projectRoot.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { computeTopologicalOrder } from '../graph/topology.js';

export async function handleGetTopologicalOrder(args: Record<string, unknown>) {
  const files: string[] | undefined = Array.isArray(args.files)
    ? (args.files as string[])
    : undefined;

  const projectRoot = findProjectRoot(process.cwd());

  if (!(await hasGraph(projectRoot))) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(noGraphError(projectRoot), null, 2),
      }],
      isError: true,
    };
  }

  const edges = await getAllEdges(projectRoot);
  const result = computeTopologicalOrder(edges, files);

  const cycleNote = result.has_cycles
    ? `\n\n⚠️  Circular dependencies detected in ${result.cyclic_files.length} file(s). These cannot be strictly ordered and are listed in cyclic_files. Consider running get_circular_deps for details.`
    : '';

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        summary: result.has_cycles
          ? `Partial topological order computed (${result.order.length} files ordered, ${result.cyclic_files.length} in cycles).`
          : `Topological order computed for ${result.order.length} file(s). No cycles detected.`,
        order: result.order,
        has_cycles: result.has_cycles,
        cyclic_files: result.cyclic_files,
      }, null, 2) + cycleNote,
    }],
  };
}
