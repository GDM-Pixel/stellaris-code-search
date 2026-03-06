import { findProjectRoot } from '../indexer/scanner.js';
import { embedText } from '../indexer/embedder.js';
import { searchByVector, hasIndex } from '../store/lancedb.js';

export async function handleSearchCode(args: Record<string, unknown>) {
  const query = args.query as string;
  const limit = (args.limit as number) ?? 10;
  const extensions = args.extensions as string[] | undefined;

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

  // Embed the query
  const queryVector = await embedText(query);

  // Search in code chunks only, with optional extension filter
  // Over-fetch when filtering by extension (results are filtered post-query)
  const fetchLimit = extensions ? limit * 3 : limit;
  const filter = `chunk_type != 'doc_section'`;
  let results = await searchByVector(projectRoot, queryVector, fetchLimit, filter);

  if (extensions && extensions.length > 0) {
    const normalizedExts = extensions.map(e => e.startsWith('.') ? e : `.${e}`);
    results = results
      .filter(r => normalizedExts.some(ext => r.file_path.endsWith(ext)))
      .slice(0, limit);
  }

  const formatted = results.map((r, i) => ({
    rank: i + 1,
    file: r.file_path,
    name: r.name,
    type: r.chunk_type,
    lines: `${r.line_start}-${r.line_end}`,
    score: Math.round((1 - r._distance) * 100) / 100,
    preview: r.content.split('\n').filter(l => !l.startsWith('//')).slice(0, 8).join('\n'),
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
