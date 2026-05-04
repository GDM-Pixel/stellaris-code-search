import { findProjectRoot } from '../indexer/scanner.js';
import { hasIndex } from '../store/lancedb.js';
import { hasFTSIndex } from '../store/fts.js';
import { hybridSearch } from '../search/hybrid.js';

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

  const [hasVector, hasFTS] = await Promise.all([
    hasIndex(projectRoot),
    hasFTSIndex(projectRoot),
  ]);

  if (!hasVector && !hasFTS) {
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

  const results = await hybridSearch(projectRoot, query, limit, {
    chunkType: 'doc_section',
  });

  const formatted = results.map((r, i) => ({
    rank: i + 1,
    file: r.file_path,
    section: r.name,
    lines: `${r.line_start}-${r.line_end}`,
    score: r.score,
    sources: r.sources,
    content: r.content,
  }));

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        query,
        results_count: formatted.length,
        search_mode: (hasVector && hasFTS) ? 'hybrid' : hasVector ? 'vector' : 'fts',
        results: formatted,
      }, null, 2),
    }],
  };
}
