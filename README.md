<p align="center">
  <img src="assets/banner.jpeg" alt="Stellaris MCP" width="100%" />
</p>

# Stellaris MCP

An MCP server that combines **semantic search** (OpenAI embeddings + LanceDB) with **AST-based code exploration** (tree-sitter) for AI agents.

Search your codebase with natural language, browse file structures, inspect symbol outlines, and retrieve exact source code — all through the Model Context Protocol.

> [Version francaise / French version](README.fr.md)

## Features

- **Semantic search** across code and documentation via embeddings
- **AST exploration**: file tree, symbol outlines, source extraction — zero API calls
- **Context-aware**: imports, sibling symbols, and TODO/FIXME warnings included automatically
- **Incremental indexing**: only changed files are re-embedded
- **Safe by default**: no auto-indexing until you explicitly run `reindex` for the first time
- **Auto-indexing** on subsequent startups (opt-in via `.stellarisrc`)
- **10 languages**: TypeScript, JavaScript, TSX, JSX, Python, Go, Rust, PHP, HTML, CSS
- **Documentation**: indexes and searches Markdown files
- **Graceful degradation**: works without `OPENAI_API_KEY` (AST tools still available)

## Tools (6)

### Semantic search (requires OpenAI API key)

| Tool | Description |
|------|-------------|
| `search_code` | Natural language search in code files. Returns files, lines, and previews. |
| `search_docs` | Natural language search in Markdown documentation. |
| `reindex` | Force incremental re-indexing of the project. Accepts `enable_auto_index` to toggle auto-indexing. |

### Structural exploration (no API calls)

| Tool | Description |
|------|-------------|
| `get_file_tree` | Project file tree with language stats. |
| `get_file_outline` | List symbols in a file with line ranges + file imports, exports, and TODO/FIXME warnings. |
| `get_symbol` | Retrieve the full source code of a specific symbol + surrounding file context (imports, sibling symbols, warnings). |

## Context-aware design

A common pitfall with code search tools is returning results that are **too precise** — the LLM gets the exact function it asked for, but misses the surrounding context needed to make safe decisions (imports, sibling functions, TODO warnings).

Stellaris addresses this with **automatic context enrichment**:

- **`get_symbol`** returns the requested source code **plus** file-level context by default:
  - **Imports** — so the LLM knows where dependencies come from
  - **Sibling symbols** — names and line ranges of other functions/classes in the same file, preventing duplications and revealing patterns
  - **Warnings** — TODO, FIXME, HACK, NOTE, @deprecated comments found anywhere in the file

- **`get_file_outline`** returns symbol names **plus** the file's imports and exports, so the LLM understands the dependency graph before diving into code.

This adds ~100-200 tokens of "useful noise" per call — far cheaper than reading the entire file (~800-2000 tokens), while preventing blind refactoring errors.

The `context` parameter on `get_symbol` can be set to `false` if you only need the raw source.

### Example `get_symbol` response

```json
{
  "file": "src/indexer/chunker.ts",
  "symbol": "chunkCodeAST",
  "lines": "299-380",
  "source": "function chunkCodeAST(content, file) { ... }",
  "file_context": {
    "imports": ["node:crypto", "tree-sitter", "../config/defaults.js"],
    "exports": ["chunkFile", "parseFileSymbols", "extractFileContext"],
    "siblings": [
      "function extractImports (261-285)",
      "function chunkMarkdown (382-429)",
      "function chunkCodeFallback (431-465)"
    ],
    "warnings": ["L42: TODO handle edge case for empty files"]
  }
}
```

## Recommended workflow

1. **`reindex`** to index the project for the first time (required before semantic search)
2. **`get_file_tree`** to discover the project structure
3. **`search_code`** to find features by natural language description
4. **`get_file_outline`** to view symbols + imports/exports in a matched file
5. **`get_symbol`** to retrieve exact source code with surrounding context

Steps 2, 4, and 5 consume **zero API tokens** — only semantic search uses OpenAI embeddings.

After the first `reindex`, a `.stellarisrc` file is created in the project root with `auto_index=true`. Subsequent server startups will automatically run incremental indexing (only changed files).

## Installation

```bash
git clone https://github.com/GDM-Pixel/stellaris-code-search.git
cd stellaris-code-search
npm install
npm run build
```

## Configuration

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | For search/indexing | OpenAI API key for embeddings (`text-embedding-3-small`) |

Without `OPENAI_API_KEY`, the server starts normally — `get_file_tree`, `get_file_outline`, and `get_symbol` work without it.

### `.vectorconfig.json` (optional)

Place at the root of the project to index:

```json
{
  "include": ["src/**", "packages/**", "docs/**"],
  "exclude": ["node_modules/**", "dist/**", "**/*.test.ts"],
  "chunkStrategy": "ast"
}
```

### `.stellarisrc` (auto-generated)

Created automatically after the first successful `reindex`. Controls auto-indexing behavior on server startup.

```
# Stellaris Code Search configuration
# Set auto_index=true to enable automatic incremental indexing on startup
auto_index=true
```

You can toggle this via the `reindex` tool (`enable_auto_index: false`) or edit the file manually. Deleting the file disables auto-indexing.

### `.vectorignore` (optional)

Same syntax as `.gitignore`, to exclude files from indexing.

## Claude Desktop integration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stellaris-mcp": {
      "command": "node",
      "args": ["/path/to/stellaris-code-search/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Supported languages

| Language | Extensions | AST Parsing | Symbol types |
|----------|-----------|-------------|--------------|
| TypeScript | `.ts` | tree-sitter | function, component, hook, class, type |
| TSX | `.tsx` | tree-sitter | function, component, hook, class, type |
| JavaScript | `.js` | tree-sitter | function, component, class |
| JSX | `.jsx` | tree-sitter | function, component, class |
| Python | `.py` | tree-sitter | function, class |
| Go | `.go` | tree-sitter | function, method, type |
| Rust | `.rs` | tree-sitter | function, struct, impl, trait, type |
| PHP | `.php` | tree-sitter | function, class, type |
| HTML | `.html` | tree-sitter | element |
| CSS | `.css` | tree-sitter | rule |
| Markdown | `.md`, `.mdx` | regex | doc_section |

## Architecture

```
src/
  index.ts              # MCP entry point, tool registration
  startup.ts            # Auto-indexing on startup (reads .stellarisrc)
  config/
    defaults.ts         # Extensions, chunking settings, LanceDB config
    loader.ts           # .vectorconfig.json loader
    stellarisrc.ts      # .stellarisrc reader/writer
  indexer/
    scanner.ts          # File scanning (.gitignore, .vectorignore)
    chunker.ts          # Multi-language AST parsing + symbol extraction
    embedder.ts         # OpenAI embeddings (batch)
    hasher.ts           # SHA-256 hashing for incremental indexing
  store/
    lancedb.ts          # LanceDB vector storage
  tools/
    searchCode.ts       # search_code tool
    searchDocs.ts       # search_docs tool
    reindex.ts          # reindex tool
    getFileTree.ts      # get_file_tree tool
    getFileOutline.ts   # get_file_outline tool
    getSymbol.ts        # get_symbol tool
```

## Storage

The index is stored in `.vectors/` at the project root:
- `.vectors/lancedb/` — LanceDB vector database
- `.vectors/meta.json` — file meta-index (hashes, chunk IDs, timestamps)

This directory is automatically excluded from scanning.

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm run watch  # Watch mode compilation
```

## License

[MIT](LICENSE)
