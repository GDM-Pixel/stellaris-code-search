import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import Parser from 'tree-sitter';
import TypeScriptLanguage from 'tree-sitter-typescript';
import PythonLanguage from 'tree-sitter-python';
import GoLanguage from 'tree-sitter-go';
import RustLanguage from 'tree-sitter-rust';
import PHPLanguage from 'tree-sitter-php';
import HTMLLanguage from 'tree-sitter-html';
import CSSLanguage from 'tree-sitter-css';
import JavaLanguage from 'tree-sitter-java';
import RubyLanguage from 'tree-sitter-ruby';
import { CHUNK_CONFIG } from '../config/defaults.js';
import type { FileInfo } from './scanner.js';

const { typescript: TSLanguage, tsx: TSXLanguage } = TypeScriptLanguage;

export interface Chunk {
  id: string;
  file_path: string;
  chunk_type: 'function' | 'component' | 'hook' | 'class' | 'type' | 'export' | 'module' | 'doc_section' | 'method' | 'struct' | 'trait' | 'impl' | 'rule' | 'element';
  name: string;
  content: string;
  line_start: number;
  line_end: number;
}

// Parser cache per language
const parsers = new Map<string, Parser>();

interface LanguageConfig {
  language: any;
  topLevelTypes: string[];
  nameExtractor: (node: Parser.SyntaxNode) => string | null;
  chunkClassifier: (name: string, nodeType: string) => Chunk['chunk_type'];
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  '.ts': {
    language: TSLanguage,
    topLevelTypes: ['export_statement', 'function_declaration', 'class_declaration', 'type_alias_declaration', 'interface_declaration', 'enum_declaration', 'lexical_declaration'],
    nameExtractor: extractTSName,
    chunkClassifier: classifyTS,
  },
  '.tsx': {
    language: TSXLanguage,
    topLevelTypes: ['export_statement', 'function_declaration', 'class_declaration', 'type_alias_declaration', 'interface_declaration', 'enum_declaration', 'lexical_declaration'],
    nameExtractor: extractTSName,
    chunkClassifier: classifyTS,
  },
  '.js': {
    language: TSLanguage,
    topLevelTypes: ['export_statement', 'function_declaration', 'class_declaration', 'lexical_declaration'],
    nameExtractor: extractTSName,
    chunkClassifier: classifyTS,
  },
  '.jsx': {
    language: TSXLanguage,
    topLevelTypes: ['export_statement', 'function_declaration', 'class_declaration', 'lexical_declaration'],
    nameExtractor: extractTSName,
    chunkClassifier: classifyTS,
  },
  '.py': {
    language: PythonLanguage,
    topLevelTypes: ['function_definition', 'class_definition', 'decorated_definition'],
    nameExtractor: extractPythonName,
    chunkClassifier: classifyPython,
  },
  '.go': {
    language: GoLanguage,
    topLevelTypes: ['function_declaration', 'method_declaration', 'type_declaration'],
    nameExtractor: extractGoName,
    chunkClassifier: classifyGo,
  },
  '.rs': {
    language: RustLanguage,
    topLevelTypes: ['function_item', 'struct_item', 'enum_item', 'impl_item', 'trait_item', 'type_item', 'mod_item'],
    nameExtractor: extractRustName,
    chunkClassifier: classifyRust,
  },
  '.php': {
    language: (PHPLanguage as any).php,
    topLevelTypes: ['function_definition', 'class_declaration', 'interface_declaration', 'trait_declaration'],
    nameExtractor: extractPHPName,
    chunkClassifier: classifyPHP,
  },
  '.html': {
    language: HTMLLanguage,
    topLevelTypes: ['element'],
    nameExtractor: extractHTMLName,
    chunkClassifier: () => 'element',
  },
  '.css': {
    language: CSSLanguage,
    topLevelTypes: ['rule_set', 'media_statement', 'keyframes_statement', 'import_statement'],
    nameExtractor: extractCSSName,
    chunkClassifier: () => 'rule',
  },
  '.java': {
    language: JavaLanguage,
    topLevelTypes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'annotation_type_declaration'],
    nameExtractor: extractJavaName,
    chunkClassifier: classifyJava,
  },
  '.rb': {
    language: RubyLanguage,
    topLevelTypes: ['class', 'module', 'method', 'singleton_method'],
    nameExtractor: extractRubyName,
    chunkClassifier: classifyRuby,
  },
};

function getParser(extension: string): Parser | null {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) return null;

  if (!parsers.has(extension)) {
    const parser = new Parser();
    parser.setLanguage(config.language);
    parsers.set(extension, parser);
  }
  return parsers.get(extension)!;
}

// --- TypeScript / JavaScript name extraction ---

function extractTSName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'export_statement') {
    const decl = node.children.find((c) =>
      ['function_declaration', 'lexical_declaration', 'class_declaration',
       'type_alias_declaration', 'interface_declaration', 'enum_declaration'].includes(c.type),
    );
    if (decl) return extractTSName(decl);
    return null;
  }

  const nameNode = node.children.find((c) => c.type === 'identifier' || c.type === 'type_identifier');
  if (nameNode) return nameNode.text;

  if (node.type === 'lexical_declaration') {
    for (let j = 0; j < node.childCount; j++) {
      const varDecl = node.child(j)!;
      if (varDecl.type === 'variable_declarator') {
        const id = varDecl.children.find((c) => c.type === 'identifier');
        if (id) return id.text;
      }
    }
  }

  return null;
}

function classifyTS(name: string, nodeType: string): Chunk['chunk_type'] {
  if (name.startsWith('use') && name[3] === name[3]?.toUpperCase()) return 'hook';
  if (/^[A-Z]/.test(name)) return 'component';
  if (nodeType === 'class_declaration') return 'class';
  if (['type_alias_declaration', 'interface_declaration', 'enum_declaration'].includes(nodeType)) return 'type';
  return 'function';
}

// --- Python name extraction ---

function extractPythonName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'decorated_definition') {
    const inner = node.children.find((c) => c.type === 'function_definition' || c.type === 'class_definition');
    if (inner) return extractPythonName(inner);
    return null;
  }
  const nameNode = node.children.find((c) => c.type === 'identifier');
  return nameNode?.text ?? null;
}

function classifyPython(name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'class_definition') return 'class';
  if (nodeType === 'decorated_definition') return 'function';
  return 'function';
}

// --- Go name extraction ---

function extractGoName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'type_declaration') {
    const spec = node.children.find((c) => c.type === 'type_spec');
    if (spec) {
      const nameNode = spec.children.find((c) => c.type === 'type_identifier');
      return nameNode?.text ?? null;
    }
    return null;
  }
  if (node.type === 'method_declaration') {
    const nameNode = node.children.find((c) => c.type === 'field_identifier');
    return nameNode?.text ?? null;
  }
  const nameNode = node.children.find((c) => c.type === 'identifier');
  return nameNode?.text ?? null;
}

function classifyGo(name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'type_declaration') return 'type';
  if (nodeType === 'method_declaration') return 'method';
  return 'function';
}

// --- Rust name extraction ---

function extractRustName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'impl_item') {
    const typeId = node.children.find((c) => c.type === 'type_identifier');
    return typeId ? `impl ${typeId.text}` : null;
  }
  const nameNode = node.children.find((c) => c.type === 'identifier' || c.type === 'type_identifier');
  return nameNode?.text ?? null;
}

function classifyRust(_name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'struct_item' || nodeType === 'enum_item') return 'struct';
  if (nodeType === 'impl_item') return 'impl';
  if (nodeType === 'trait_item') return 'trait';
  if (nodeType === 'type_item') return 'type';
  return 'function';
}

// --- PHP name extraction ---

function extractPHPName(node: Parser.SyntaxNode): string | null {
  const nameNode = node.children.find((c) => c.type === 'name');
  return nameNode?.text ?? null;
}

function classifyPHP(_name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'class_declaration') return 'class';
  if (nodeType === 'interface_declaration' || nodeType === 'trait_declaration') return 'type';
  return 'function';
}

// --- HTML name extraction ---

function extractHTMLName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'element') {
    const startTag = node.children.find((c) => c.type === 'start_tag');
    if (startTag) {
      const tagName = startTag.children.find((c) => c.type === 'tag_name');
      return tagName?.text ?? null;
    }
  }
  return null;
}

// --- CSS name extraction ---

function extractCSSName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'rule_set') {
    const selectors = node.children.find((c) => c.type === 'selectors');
    return selectors?.text ?? null;
  }
  if (node.type === 'media_statement') return '@media';
  if (node.type === 'keyframes_statement') {
    const nameNode = node.children.find((c) => c.type === 'keyframes_name');
    return nameNode ? `@keyframes ${nameNode.text}` : '@keyframes';
  }
  if (node.type === 'import_statement') return '@import';
  return null;
}

// --- Java name extraction ---

function extractJavaName(node: Parser.SyntaxNode): string | null {
  const nameNode = node.children.find((c) => c.type === 'identifier');
  return nameNode?.text ?? null;
}

function classifyJava(_name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'interface_declaration') return 'type';
  if (nodeType === 'enum_declaration') return 'type';
  if (nodeType === 'annotation_type_declaration') return 'type';
  return 'class';
}

// --- Ruby name extraction ---

function extractRubyName(node: Parser.SyntaxNode): string | null {
  if (node.type === 'method' || node.type === 'singleton_method') {
    const nameNode = node.children.find((c) => c.type === 'identifier' || c.type === 'constant');
    return nameNode?.text ?? null;
  }
  if (node.type === 'class' || node.type === 'module') {
    const nameNode = node.children.find((c) => c.type === 'constant' || c.type === 'scope_resolution');
    return nameNode?.text ?? null;
  }
  return null;
}

function classifyRuby(_name: string, nodeType: string): Chunk['chunk_type'] {
  if (nodeType === 'class') return 'class';
  if (nodeType === 'module') return 'type';
  return 'method';
}

// --- Generic AST chunking ---

function buildHeader(file: FileInfo, imports: string[], exports: string[]): string {
  const lines = [`// File: ${file.relativePath}`];
  if (exports.length > 0) lines.push(`// Exports: ${exports.join(', ')}`);
  if (imports.length > 0) lines.push(`// Imports: ${imports.slice(0, 10).join(', ')}`);
  return lines.join('\n');
}

export function extractImports(rootNode: Parser.SyntaxNode, extension: string): string[] {
  const imports: string[] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;

    if (child.type === 'import_statement') {
      // TS/JS/CSS
      const source = child.children.find((c) => c.type === 'string')?.text;
      if (source) imports.push(source.replace(/['"]/g, ''));
    } else if (child.type === 'import_from_statement' || child.type === 'import_statement') {
      // Python
      if (extension === '.py') {
        const mod = child.children.find((c) => c.type === 'dotted_name');
        if (mod) imports.push(mod.text);
      }
    } else if (child.type === 'use_declaration') {
      // Rust
      const path = child.children.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (path) imports.push(path.text);
    } else if (child.type === 'import_declaration') {
      // Java: import com.example.Foo;
      const name = child.children.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (name) imports.push(name.text);
    } else if (child.type === 'require' || child.type === 'require_relative') {
      // Ruby: require 'foo' / require_relative 'bar'
      const arg = child.children.find((c) => c.type === 'string');
      if (arg) imports.push(arg.text.replace(/['"]/g, ''));
    }
  }

  return imports;
}

/**
 * Extract raw import strings from a file (convenience wrapper).
 * Used by the graph builder to feed the import resolver.
 */
/**
 * Regex-based import extraction for files without a tree-sitter parser
 * (.astro, .vue, .svelte, .mdx, etc.).
 */
function extractImportsRegex(content: string): string[] {
  const results: string[] = [];

  // For .astro files: only scan inside the frontmatter block (between --- delimiters)
  let scanContent = content;
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    scanContent = frontmatterMatch[1];
  }

  // Static imports: import X from '...' or import '...'
  const staticRe = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(scanContent)) !== null) {
    results.push(m[1]);
  }
  // Dynamic imports: import('...')
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(scanContent)) !== null) {
    results.push(m[1]);
  }
  return [...new Set(results)];
}

export function extractFileImports(content: string, extension: string): string[] {
  const config = LANGUAGE_CONFIGS[extension];
  const parser = config ? getParser(extension) : null;

  if (parser) {
    const tree = parser.parse(content);
    return extractImports(tree.rootNode, extension);
  }

  // Fallback: regex-based extraction for .astro, .vue, .svelte, .mdx, etc.
  return extractImportsRegex(content);
}

function extractExportNames(rootNode: Parser.SyntaxNode, config: LanguageConfig): string[] {
  const names: string[] = [];
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;
    if (config.topLevelTypes.includes(child.type)) {
      const name = config.nameExtractor(child);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function chunkCodeAST(content: string, file: FileInfo): Chunk[] {
  const config = LANGUAGE_CONFIGS[file.extension];
  if (!config) return chunkCodeFallback(content, file);

  const parser = getParser(file.extension);
  if (!parser) return chunkCodeFallback(content, file);

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;
  const lines = content.split('\n');

  const imports = extractImports(rootNode, file.extension);
  const exportNames = extractExportNames(rootNode, config);
  const header = buildHeader(file, imports, exportNames);

  // Small files → single chunk
  if (lines.length <= CHUNK_CONFIG.smallFileThreshold) {
    return [{
      id: randomUUID(),
      file_path: file.relativePath,
      chunk_type: 'module',
      name: basename(file.relativePath),
      content: `${header}\n\n${content}`,
      line_start: 1,
      line_end: lines.length,
    }];
  }

  const chunks: Chunk[] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;

    // For TS/JS, handle export_statement wrapping
    let targetNode = child;
    if (child.type === 'export_statement') {
      const inner = child.children.find((c) => config.topLevelTypes.includes(c.type) && c.type !== 'export_statement');
      if (inner) targetNode = child; // keep the export wrapper for full source
    }

    if (!config.topLevelTypes.includes(child.type)) continue;

    const name = config.nameExtractor(child);
    if (!name) continue;

    const startRow = child.startPosition.row;
    const endRow = child.endPosition.row;
    const symbolLines = lines.slice(startRow, endRow + 1);

    // Determine the actual declaration node type for classification
    let declType = child.type;
    if (child.type === 'export_statement') {
      const inner = child.children.find((c) => c.type !== 'export' && config.topLevelTypes.includes(c.type));
      if (inner) declType = inner.type;
    }

    const chunkType = config.chunkClassifier(name, declType);

    // Bound chunk size: symbols > maxSymbolLines are split into sub-chunks
    // to avoid silent truncation by the OpenAI embeddings API (8192 token limit)
    const maxLines = CHUNK_CONFIG.maxSymbolLines;
    if (symbolLines.length > maxLines) {
      for (let offset = 0; offset < symbolLines.length; offset += maxLines) {
        const slice = symbolLines.slice(offset, offset + maxLines);
        const partLabel = offset === 0 ? '' : ` (part ${Math.floor(offset / maxLines) + 1})`;
        chunks.push({
          id: randomUUID(),
          file_path: file.relativePath,
          chunk_type: chunkType,
          name: `${name}${partLabel}`,
          content: `${header}\n\n${slice.join('\n')}`,
          line_start: startRow + offset + 1,
          line_end: startRow + Math.min(offset + maxLines, symbolLines.length),
        });
      }
    } else {
      chunks.push({
        id: randomUUID(),
        file_path: file.relativePath,
        chunk_type: chunkType,
        name,
        content: `${header}\n\n${symbolLines.join('\n')}`,
        line_start: startRow + 1,
        line_end: endRow + 1,
      });
    }
  }

  // Fallback: if no chunks extracted, treat as single module
  if (chunks.length === 0) {
    chunks.push({
      id: randomUUID(),
      file_path: file.relativePath,
      chunk_type: 'module',
      name: basename(file.relativePath),
      content: `${header}\n\n${content}`,
      line_start: 1,
      line_end: lines.length,
    });
  }

  return chunks;
}

function chunkMarkdown(content: string, file: FileInfo): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  let currentHeading = basename(file.relativePath);
  let currentStart = 0;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);

    if (headingMatch && currentLines.length > 0) {
      const text = currentLines.join('\n').trim();
      if (text.length > 0) {
        chunks.push({
          id: randomUUID(),
          file_path: file.relativePath,
          chunk_type: 'doc_section',
          name: currentHeading,
          content: `// File: ${file.relativePath}\n// Section: ${currentHeading}\n\n${text}`,
          line_start: currentStart + 1,
          line_end: i,
        });
      }
      currentHeading = headingMatch[2].trim();
      currentStart = i;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  const text = currentLines.join('\n').trim();
  if (text.length > 0) {
    chunks.push({
      id: randomUUID(),
      file_path: file.relativePath,
      chunk_type: 'doc_section',
      name: currentHeading,
      content: `// File: ${file.relativePath}\n// Section: ${currentHeading}\n\n${text}`,
      line_start: currentStart + 1,
      line_end: lines.length,
    });
  }

  return chunks;
}

function chunkCodeFallback(content: string, file: FileInfo): Chunk[] {
  const lines = content.split('\n');
  const header = `// File: ${file.relativePath}`;

  if (lines.length <= CHUNK_CONFIG.smallFileThreshold) {
    return [{
      id: randomUUID(),
      file_path: file.relativePath,
      chunk_type: 'module',
      name: basename(file.relativePath),
      content: `${header}\n\n${content}`,
      line_start: 1,
      line_end: lines.length,
    }];
  }

  const chunkSize = 200;
  const chunks: Chunk[] = [];

  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    const chunkContent = slice.join('\n');
    chunks.push({
      id: randomUUID(),
      file_path: file.relativePath,
      chunk_type: 'module',
      name: `${basename(file.relativePath)}:${i + 1}-${Math.min(i + chunkSize, lines.length)}`,
      content: `${header}\n\n${chunkContent}`,
      line_start: i + 1,
      line_end: Math.min(i + chunkSize, lines.length),
    });
  }

  return chunks;
}

export async function chunkFile(file: FileInfo): Promise<Chunk[]> {
  const content = await readFile(file.absolutePath, 'utf-8');

  if (file.category === 'docs') {
    return chunkMarkdown(content, file);
  }

  try {
    return chunkCodeAST(content, file);
  } catch {
    return chunkCodeFallback(content, file);
  }
}

/**
 * Parse a file and return its top-level symbols (for outline/symbol tools).
 * Does NOT embed — just extracts structure.
 */
export interface SymbolInfo {
  name: string;
  kind: Chunk['chunk_type'];
  line_start: number;
  line_end: number;
  file_path: string;
}

export function parseFileSymbols(content: string, filePath: string, extension: string): SymbolInfo[] {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) return [];

  const parser = getParser(extension);
  if (!parser) return [];

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;
  const symbols: SymbolInfo[] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;

    if (!config.topLevelTypes.includes(child.type)) continue;

    const name = config.nameExtractor(child);
    if (!name) continue;

    let declType = child.type;
    if (child.type === 'export_statement') {
      const inner = child.children.find((c) => c.type !== 'export' && config.topLevelTypes.includes(c.type));
      if (inner) declType = inner.type;
    }

    symbols.push({
      name,
      kind: config.chunkClassifier(name, declType),
      line_start: child.startPosition.row + 1,
      line_end: child.endPosition.row + 1,
      file_path: filePath,
    });
  }

  return symbols;
}

/**
 * Extract file-level context: imports, exports, and all symbol names.
 * Provides the "useful noise" that prevents LLMs from making blind decisions.
 */
export interface FileContext {
  imports: string[];
  exports: string[];
  symbols: Array<{ name: string; kind: Chunk['chunk_type']; lines: string }>;
  comments: string[];
}

export function extractFileContext(content: string, filePath: string, extension: string): FileContext {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) {
    return { imports: [], exports: [], symbols: [], comments: [] };
  }

  const parser = getParser(extension);
  if (!parser) {
    return { imports: [], exports: [], symbols: [], comments: [] };
  }

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;

  const imports = extractImports(rootNode, extension);
  const exports = extractExportNames(rootNode, config);

  // Collect all symbols with their kinds
  const symbols: FileContext['symbols'] = [];
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;
    if (!config.topLevelTypes.includes(child.type)) continue;

    const name = config.nameExtractor(child);
    if (!name) continue;

    let declType = child.type;
    if (child.type === 'export_statement') {
      const inner = child.children.find((c) => c.type !== 'export' && config.topLevelTypes.includes(c.type));
      if (inner) declType = inner.type;
    }

    symbols.push({
      name,
      kind: config.chunkClassifier(name, declType),
      lines: `${child.startPosition.row + 1}-${child.endPosition.row + 1}`,
    });
  }

  // Extract top-level comments (TODO, FIXME, HACK, NOTE, @deprecated)
  const lines = content.split('\n');
  const comments: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\s*(\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|NOTE|WARN|@deprecated)/i.test(line)) {
      comments.push(`L${i + 1}: ${line.replace(/^\s*(\/\/|#|\/\*|\*)\s*/, '').trim()}`);
    }
  }

  return { imports, exports, symbols, comments };
}

/**
 * Combined single-pass: parse symbols AND extract context in one AST traversal.
 * Use this instead of calling parseFileSymbols + extractFileContext separately.
 */
export function parseFileSymbolsAndContext(
  content: string,
  filePath: string,
  extension: string,
): { symbols: SymbolInfo[]; context: FileContext } {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) {
    return { symbols: [], context: { imports: [], exports: [], symbols: [], comments: [] } };
  }

  const parser = getParser(extension);
  if (!parser) {
    return { symbols: [], context: { imports: [], exports: [], symbols: [], comments: [] } };
  }

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;

  const imports = extractImports(rootNode, extension);
  const exports = extractExportNames(rootNode, config);
  const symbols: SymbolInfo[] = [];
  const ctxSymbols: FileContext['symbols'] = [];

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;
    if (!config.topLevelTypes.includes(child.type)) continue;

    const name = config.nameExtractor(child);
    if (!name) continue;

    let declType = child.type;
    if (child.type === 'export_statement') {
      const inner = child.children.find((c) => c.type !== 'export' && config.topLevelTypes.includes(c.type));
      if (inner) declType = inner.type;
    }

    const kind = config.chunkClassifier(name, declType);
    const line_start = child.startPosition.row + 1;
    const line_end = child.endPosition.row + 1;

    symbols.push({ name, kind, line_start, line_end, file_path: filePath });
    ctxSymbols.push({ name, kind, lines: `${line_start}-${line_end}` });
  }

  const lines = content.split('\n');
  const comments: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\s*(\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|NOTE|WARN|@deprecated)/i.test(line)) {
      comments.push(`L${i + 1}: ${line.replace(/^\s*(\/\/|#|\/\*|\*)\s*/, '').trim()}`);
    }
  }

  return {
    symbols,
    context: { imports, exports, symbols: ctxSymbols, comments },
  };
}

/**
 * Extract the full source code of a specific symbol from a file.
 */
export function extractSymbolSource(content: string, extension: string, symbolName: string): { source: string; line_start: number; line_end: number } | null {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config) return null;

  const parser = getParser(extension);
  if (!parser) return null;

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;
  const lines = content.split('\n');

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i)!;

    if (!config.topLevelTypes.includes(child.type)) continue;

    const name = config.nameExtractor(child);
    if (name !== symbolName) continue;

    const startRow = child.startPosition.row;
    const endRow = child.endPosition.row;

    return {
      source: lines.slice(startRow, endRow + 1).join('\n'),
      line_start: startRow + 1,
      line_end: endRow + 1,
    };
  }

  return null;
}
