import { findProjectRoot } from '../indexer/scanner.js';
import { getDependents, hasGraph } from '../graph/store.js';

export async function handleGetDependents(args: Record<string, unknown>) {
  const filePath = args.file as string;

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

  const deps = await getDependents(projectRoot, filePath);
  const nextSteps = deps.length > 0
    ? `\n\n💡 Next steps:\n  • get_blast_radius("${filePath}") — full impact analysis with depth\n  • get_dependencies("${filePath}") — see what this file imports\n${deps.slice(0, 2).map(d => `  • get_file_outline("${d.source_file}") — explore dependent`).join('\n')}`
    : `\n\n💡 Next steps:\n  • get_dependencies("${filePath}") — see what this file imports`;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        file: filePath,
        dependent_count: deps.length,
        dependents: deps.map(d => ({
          file: d.source_file,
          imports: d.import_names,
        })),
      }, null, 2) + nextSteps,
    }],
  };
}
