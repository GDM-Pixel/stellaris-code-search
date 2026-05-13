import { findProjectRoot } from '../indexer/scanner.js';
import { getDependencies, hasGraph } from '../graph/store.js';
import { computeDependencyChain } from '../graph/blast.js';
import { getTierConfig, truncateIfOversized } from '../utils/responseTier.js';

export async function handleGetDependencies(args: Record<string, unknown>) {
  const filePath = args.file as string;
  const tier = getTierConfig();
  const userDepth = args.depth as number | undefined;
  const depth = Math.min(userDepth ?? 1, tier.maxGraphDepth);

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
        text: JSON.stringify({
          error: 'NO_GRAPH',
          message: 'No dependency graph found. Please run reindex first to build the graph.',
        }, null, 2),
      }],
      isError: true,
    };
  }

  if (depth === 1) {
    const deps = await getDependencies(projectRoot, filePath);
    const nextSteps = deps.length > 0
      ? `\n\n💡 Next steps:\n  • get_dependents("${filePath}") — see what depends on this file\n  • get_blast_radius("${filePath}") — full impact analysis\n${deps.slice(0, 2).map(d => `  • get_file_outline("${d.target_file}") — explore dependency`).join('\n')}`
      : '';

    const payload = truncateIfOversized({
      file: filePath,
      dependency_count: deps.length,
      dependencies: deps.map(d => ({
        file: d.target_file,
        imports: d.import_names,
      })),
    }, ['dependencies']);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2) + nextSteps,
      }],
    };
  }

  // Multi-depth: use chain traversal
  const chain = await computeDependencyChain(projectRoot, filePath, depth);

  const payload = truncateIfOversized({
    file: filePath,
    max_depth: depth,
    dependency_count: chain.dependency_count,
    dependencies: chain.dependencies.map(d => ({
      file: d.file_path,
      depth: d.depth,
    })),
  }, ['dependencies']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2) + `\n\n💡 Next steps:\n  • get_dependents("${filePath}") — see what depends on this file\n  • get_blast_radius("${filePath}") — full impact analysis`,
    }],
  };
}
