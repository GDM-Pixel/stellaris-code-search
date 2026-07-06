import { findProjectRoot } from '../indexer/scanner.js';
import { noGraphError } from '../config/projectRoot.js';
import { hasGraph, getGraphStats } from '../graph/store.js';
import { computeBlastRadius } from '../graph/blast.js';
import { getTierConfig, truncateIfOversized } from '../utils/responseTier.js';

export async function handleGetBlastRadius(args: Record<string, unknown>) {
  const filePath = args.file as string;
  const tier = getTierConfig();
  const userDepth = args.depth as number | undefined;
  const depth = Math.min(userDepth ?? 2, tier.maxGraphDepth);

  if (!filePath || typeof filePath !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: file parameter is required (relative path from project root)' }],
      isError: true,
    };
  }

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

  const result = await computeBlastRadius(projectRoot, filePath, depth);
  const stats = await getGraphStats(projectRoot);

  // Severity assessment
  const ratio = stats.total_files > 0 ? result.impacted_count / stats.total_files : 0;
  let severity: string;
  if (ratio > 0.3) severity = 'HIGH — changes to this file affect >30% of the codebase';
  else if (ratio > 0.1) severity = 'MEDIUM — changes affect 10-30% of the codebase';
  else if (result.impacted_count > 0) severity = 'LOW — limited impact';
  else severity = 'NONE — no other files depend on this file';

  // Group impacted files by depth
  const byDepth: Record<number, string[]> = {};
  for (const f of result.impacted_files) {
    if (!byDepth[f.depth]) byDepth[f.depth] = [];
    byDepth[f.depth].push(f.file_path);
  }

  const nextSteps = result.impacted_count > 0
    ? `\n\n💡 Next steps:\n${result.impacted_files.slice(0, 3).map(f => `  • get_file_outline("${f.file_path}") — check impacted file`).join('\n')}\n  • get_dependents("${filePath}") — detailed dependency list`
    : '';

  const payload = truncateIfOversized({
    file: filePath,
    severity,
    impacted_count: result.impacted_count,
    max_depth: depth,
    graph_stats: stats,
    impacted_by_depth: byDepth,
    edges: result.edges,
  }, ['edges']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2) + nextSteps,
    }],
  };
}
