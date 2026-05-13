/**
 * Doc linker: extracts backticked symbols from markdown/spec files and links them
 * to code symbols indexed in the project.
 *
 * Inspired by codegraph-rust's `docs_contracts` analyzer
 * (crates/codegraph-mcp/src/analyzers/docs_contracts.rs).
 *
 * Algorithm:
 *   1. Walk the markdown content line by line.
 *   2. Extract every `backtick-quoted identifier`.
 *   3. Filter out junk (numbers, single chars, common english words, paths).
 *   4. For each candidate, look up its definition file in the symbol index.
 *   5. Emit a (symbol, target_file, line_number) link.
 *
 * The symbol index is built once per reindex from FTS chunk names — it's a
 * Map<symbolName, filePath> where filePath is the file where the symbol is
 * defined (function, class, etc.).
 */

const IDENTIFIER_REGEX = /`([A-Za-z_][\w$.]*)`/g;

const STOPWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'void', 'this', 'self', 'super',
  'new', 'const', 'let', 'var', 'function', 'class', 'interface', 'type',
  'import', 'export', 'from', 'default', 'return', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'throw', 'try',
  'catch', 'finally', 'async', 'await', 'yield', 'typeof', 'instanceof',
  'in', 'of', 'as', 'is', 'and', 'or', 'not', 'the', 'a', 'an',
  'string', 'number', 'boolean', 'object', 'array', 'any', 'unknown', 'never',
  'true', 'false', 'note', 'todo', 'fixme', 'warning', 'error', 'info', 'tip',
]);

export interface DocLinkExtraction {
  symbol: string;
  target_file: string;
  line_number: number;
}

/**
 * Extract doc → symbol links from markdown content.
 *
 * @param content Markdown file content (lines split on \n)
 * @param symbolIndex Map<symbolName, definitionFilePath> built from indexed code
 */
export function extractDocLinks(
  content: string,
  symbolIndex: Map<string, string>,
): DocLinkExtraction[] {
  const links: DocLinkExtraction[] = [];
  const seen = new Set<string>(); // dedupe (symbol+target+line) per doc

  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip fenced code blocks — backticks inside them are not symbol references,
    // they're just code we don't want to over-match against.
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    IDENTIFIER_REGEX.lastIndex = 0;
    let match;
    while ((match = IDENTIFIER_REGEX.exec(line)) !== null) {
      const symbol = match[1]!;
      if (!isLikelySymbol(symbol)) continue;

      // Try exact match first, then last-segment match (e.g. `Foo.bar` → `bar`)
      let targetFile = symbolIndex.get(symbol);
      if (!targetFile && symbol.includes('.')) {
        const last = symbol.split('.').pop()!;
        targetFile = symbolIndex.get(last);
      }
      if (!targetFile) continue;

      const lineNumber = i + 1;
      const key = `${symbol}|${targetFile}|${lineNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      links.push({ symbol, target_file: targetFile, line_number: lineNumber });
    }
  }

  return links;
}

function isLikelySymbol(s: string): boolean {
  if (s.length < 3) return false;
  if (STOPWORDS.has(s.toLowerCase())) return false;
  if (/^\d/.test(s)) return false;
  // Heuristic: must contain at least one uppercase letter OR an underscore OR a dot.
  // Pure-lowercase short words tend to be english prose in backticks (e.g. `foo`, `the`).
  // Identifiers in code typically have camelCase, PascalCase, snake_case, or member access.
  if (!/[A-Z_.]/.test(s)) {
    // Allow if it's a known-looking call (ends with parens — but we don't capture those here)
    // For lowercase-only single-word, require at least 4 chars to reduce noise
    if (s.length < 4) return false;
  }
  return true;
}
