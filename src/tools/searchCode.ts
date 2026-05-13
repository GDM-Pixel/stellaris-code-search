import { findProjectRoot } from '../indexer/scanner.js';
import { hasIndex } from '../store/lancedb.js';
import { hasFTSIndex } from '../store/fts.js';
import { hybridSearch } from '../search/hybrid.js';
import { clampLimit, truncateIfOversized } from '../utils/responseTier.js';

export async function handleSearchCode(args: Record<string, unknown>) {
  const query = args.query as string;
  const limit = clampLimit(args.limit as number | undefined, { defaultLimit: 10 });
  const extensions = args.extensions as string[] | undefined;

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

  // Over-fetch when filtering by extension (results are filtered post-query)
  const fetchLimit = extensions ? limit * 3 : limit;

  let results = await hybridSearch(projectRoot, query, fetchLimit, {
    chunkTypeNot: 'doc_section',
  });

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
    score: r.score,
    sources: r.sources,
    preview: r.content.split('\n').filter(l => !l.startsWith('//')).slice(0, 8).join('\n'),
  }));

  const topFiles = [...new Set(formatted.slice(0, 3).map(r => r.file))];
  const nextSteps = topFiles.length > 0
    ? `\n\n💡 Next steps:\n${topFiles.map(f => `  • get_file_outline("${f}") — see all symbols in this file`).join('\n')}\n  • get_symbol(file, name) — read a specific function with context`
    : '';

  const payload = truncateIfOversized({
    query,
    results_count: formatted.length,
    search_mode: (hasVector && hasFTS) ? 'hybrid' : hasVector ? 'vector' : 'fts',
    results: formatted,
  }, ['results']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2) + nextSteps,
    }],
  };
}
