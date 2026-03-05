import { findProjectRoot } from '../indexer/scanner.js';
import { embedText } from '../indexer/embedder.js';
import { searchByVector, hasIndex } from '../store/lancedb.js';

export async function handleSearchDocs(args: Record<string, unknown>) {
  const query = args.query as string;
  const limit = (args.limit as number) ?? 5;

  if (!query || typeof query !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: query parameter is required (string)' }],
      isError: true,
    };
  }

  const projectRoot = findProjectRoot(process.cwd());

  const indexed = await hasIndex(projectRoot);
  if (!indexed) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NO_INDEX',
          message: 'No index found for this project. Please run the reindex tool first to index the codebase.',
          project: projectRoot,
        }, null, 2),
      }],
      isError: true,
    };
  }

  const queryVector = await embedText(query);

  // Search in doc chunks only
  const filter = `chunk_type = 'doc_section'`;
  const results = await searchByVector(projectRoot, queryVector, limit, filter);

  const formatted = results.map((r, i) => ({
    rank: i + 1,
    file: r.file_path,
    section: r.name,
    lines: `${r.line_start}-${r.line_end}`,
    score: Math.round((1 - r._distance) * 100) / 100,
    content: r.content,
  }));

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        query,
        results_count: formatted.length,
        results: formatted,
      }, null, 2),
    }],
  };
}
