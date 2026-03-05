import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { extractSymbolSource, extractFileContext } from '../indexer/chunker.js';

export async function handleGetSymbol(args: Record<string, unknown>) {
  const filePath = args.file as string;
  const symbolName = args.name as string;
  const withContext = (args.context as boolean) ?? true;

  if (!filePath || typeof filePath !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: file parameter is required (relative path from project root)' }],
      isError: true,
    };
  }

  if (!symbolName || typeof symbolName !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: name parameter is required (symbol name)' }],
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

  const result = extractSymbolSource(content, extension, symbolName);

  if (!result) {
    return {
      content: [{ type: 'text' as const, text: `Error: Symbol "${symbolName}" not found in ${filePath}` }],
      isError: true,
    };
  }

  const response: Record<string, unknown> = {
    file: filePath,
    symbol: symbolName,
    lines: `${result.line_start}-${result.line_end}`,
    source: result.source,
  };

  // Add surrounding context to help LLMs understand the file
  if (withContext) {
    const ctx = extractFileContext(content, filePath, extension);

    response.file_context = {
      imports: ctx.imports,
      exports: ctx.exports,
      siblings: ctx.symbols
        .filter((s) => s.name !== symbolName)
        .map((s) => `${s.kind} ${s.name} (${s.lines})`),
    };

    if (ctx.comments.length > 0) {
      response.file_context = {
        ...(response.file_context as Record<string, unknown>),
        warnings: ctx.comments,
      };
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(response, null, 2),
    }],
  };
}
