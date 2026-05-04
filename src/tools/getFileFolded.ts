import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { parseFileSymbolsAndContext } from '../indexer/chunker.js';

interface FoldedCache {
  mtime: number;
  lines: string[];
}
const contentCache = new Map<string, FoldedCache>();

const DEFAULT_TOKEN_BUDGET = 4000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractSignature(lines: string[], lineStart: number, lineEnd: number): string {
  const slice = lines.slice(lineStart - 1, Math.min(lineEnd, lineStart + 5));
  const joined = slice.join('\n');
  const braceIdx = joined.indexOf('{');
  const arrowBraceIdx = joined.indexOf('=>');
  const colonIdx = joined.indexOf(':');
  const candidates = [braceIdx, arrowBraceIdx].filter((i) => i >= 0);
  if (candidates.length === 0) {
    if (colonIdx > 0 && slice.length === 1) return slice[0].trim();
    return slice[0].trim();
  }
  const cut = Math.min(...candidates);
  return joined.slice(0, cut).trim().replace(/\s+/g, ' ');
}

function extractJsdoc(lines: string[], lineStart: number): string | null {
  let i = lineStart - 2;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;
  if (!lines[i].trim().endsWith('*/')) return null;
  const endIdx = i;
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  if (i < 0) return null;
  const block = lines
    .slice(i, endIdx + 1)
    .map((l) => l.replace(/^\s*\/?\*+\/?/, '').trim())
    .filter((l) => l.length > 0)
    .join(' ');
  return block || null;
}

export async function handleGetFileFolded(args: Record<string, unknown>) {
  const filePath = args.file as string;
  const tokenBudget = (args.token_budget as number | undefined) ?? DEFAULT_TOKEN_BUDGET;

  if (!filePath || typeof filePath !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: file parameter is required (relative path from project root)' }],
      isError: true,
    };
  }

  const projectRoot = findProjectRoot(process.cwd());
  const absolutePath = join(projectRoot, filePath).replace(/\\/g, '/');
  const extension = '.' + filePath.split('.').pop()!;

  let mtime = 0;
  try {
    const fileStat = await stat(absolutePath);
    mtime = fileStat.mtimeMs;
  } catch {
    return {
      content: [{ type: 'text' as const, text: `Error: File not found: ${filePath}` }],
      isError: true,
    };
  }

  let lines: string[];
  const cached = contentCache.get(absolutePath);
  if (cached && cached.mtime === mtime) {
    lines = cached.lines;
  } else {
    const raw = await readFile(absolutePath, 'utf-8');
    lines = raw.split('\n');
    if (contentCache.size >= 100) {
      contentCache.delete(contentCache.keys().next().value!);
    }
    contentCache.set(absolutePath, { mtime, lines });
  }

  const content = lines.join('\n');
  const { symbols, context: ctx } = parseFileSymbolsAndContext(content, filePath, extension);

  const foldedSymbols = symbols.map((s) => {
    const signature = extractSignature(lines, s.line_start, s.line_end);
    const jsdoc = extractJsdoc(lines, s.line_start);
    return {
      name: s.name,
      type: s.kind,
      line_start: s.line_start,
      line_end: s.line_end,
      signature,
      jsdoc,
    };
  });

  let runningTokens = estimateTokens(JSON.stringify({ imports: ctx.imports, exports: ctx.exports }));
  const kept: typeof foldedSymbols = [];
  let truncated = false;
  for (const sym of foldedSymbols) {
    const cost = estimateTokens(sym.signature + (sym.jsdoc ?? ''));
    if (runningTokens + cost > tokenBudget && kept.length > 0) {
      truncated = true;
      break;
    }
    kept.push(sym);
    runningTokens += cost;
  }

  const response = {
    file: filePath,
    lines: lines.length,
    estimated_tokens: runningTokens,
    token_budget: tokenBudget,
    imports: ctx.imports,
    exports: ctx.exports,
    symbols_count: symbols.length,
    symbols_returned: kept.length,
    truncated,
    symbols: kept,
  };

  const nextSteps = `\n\n💡 Next steps:\n  • get_symbol("${filePath}", name) — read full source of a specific symbol\n  • search_code(query) — find related code across the project${truncated ? '\n  • Increase token_budget to see more symbols' : ''}`;

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2) + nextSteps,
      },
    ],
  };
}
