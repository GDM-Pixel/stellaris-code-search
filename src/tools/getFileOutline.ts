import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { parseFileSymbols, extractFileContext } from '../indexer/chunker.js';

export async function handleGetFileOutline(args: Record<string, unknown>) {
  const filePath = args.file as string;

  if (!filePath || typeof filePath !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: file parameter is required (relative path from project root)' }],
      isError: true,
    };
  }

  const projectRoot = findProjectRoot(process.cwd());
  const absolutePath = join(projectRoot, filePath).replace(/\\/g, '/');
  const extension = '.' + filePath.split('.').pop()!;

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch {
    return {
      content: [{ type: 'text' as const, text: `Error: File not found: ${filePath}` }],
      isError: true,
    };
  }

  const symbols = parseFileSymbols(content, filePath, extension);
  const ctx = extractFileContext(content, filePath, extension);
  const lineCount = content.split('\n').length;

  const response: Record<string, unknown> = {
    file: filePath,
    lines: lineCount,
    imports: ctx.imports,
    exports: ctx.exports,
    symbols_count: symbols.length,
    symbols: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      lines: `${s.line_start}-${s.line_end}`,
    })),
  };

  if (ctx.comments.length > 0) {
    response.warnings = ctx.comments;
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(response, null, 2),
    }],
  };
}
