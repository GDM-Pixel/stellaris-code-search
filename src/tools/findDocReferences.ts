/**
 * Tool: find_doc_references
 * Given a file path OR a symbol name, returns all markdown/spec files that
 * reference it (via backtick-quoted identifiers). Built from the `doc_links`
 * table populated at index time by the doc linker.
 */

import { findProjectRoot } from '../indexer/scanner.js';
import { noGraphError } from '../config/projectRoot.js';
import { hasGraph, findDocLinksForSymbol, findDocLinksForFile, getDocLinksStats } from '../graph/store.js';
import { truncateIfOversized } from '../utils/responseTier.js';

export async function handleFindDocReferences(args: Record<string, unknown>) {
  const symbol = args.symbol as string | undefined;
  const file = args.file as string | undefined;

  if (!symbol && !file) {
    const projectRoot = findProjectRoot(process.cwd());
    const stats = await hasGraph(projectRoot) ? await getDocLinksStats(projectRoot) : null;
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'MISSING_ARG',
          message: 'Provide either `symbol` (e.g. "UserService") or `file` (e.g. "src/auth/login.ts").',
          stats,
        }, null, 2),
      }],
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

  const links = symbol
    ? await findDocLinksForSymbol(projectRoot, symbol)
    : await findDocLinksForFile(projectRoot, file!);

  if (links.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query: symbol ? { symbol } : { file },
          summary: 'No documentation references found.',
          hint: symbol
            ? 'The symbol may not be indexed, or no markdown file references it via backticks.'
            : 'No markdown file references symbols from this file via backticks.',
          links: [],
        }, null, 2),
      }],
    };
  }

  // Group by doc_file for readability
  const byDoc: Record<string, { symbol: string; target_file: string; line_number: number }[]> = {};
  for (const l of links) {
    if (!byDoc[l.doc_file]) byDoc[l.doc_file] = [];
    byDoc[l.doc_file]!.push({ symbol: l.symbol, target_file: l.target_file, line_number: l.line_number });
  }

  const payload = truncateIfOversized({
    query: symbol ? { symbol } : { file },
    summary: `Found ${links.length} reference(s) across ${Object.keys(byDoc).length} doc file(s).`,
    total_references: links.length,
    by_doc: Object.entries(byDoc).map(([doc, refs]) => ({
      doc_file: doc,
      reference_count: refs.length,
      references: refs,
    })),
  }, ['by_doc']);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  };
}
