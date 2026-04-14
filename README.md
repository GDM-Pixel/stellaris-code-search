<p align="center">
  <img src="assets/banner.jpeg" alt="Stellaris MCP" width="100%" />
</p>

# Stellaris MCP

An MCP server that combines **semantic search** (OpenAI embeddings + LanceDB) with **AST-based code exploration** (tree-sitter) for AI agents.

Search your codebase with natural language, browse file structures, inspect symbol outlines, and retrieve exact source code — all through the Model Context Protocol.

> [Version francaise / French version](README.fr.md)

## Features

- **Hybrid search** (FTS5 + vector embeddings + RRF) — finds exact identifiers *and* semantic concepts
- **Dependency graph** — resolves imports to real file paths, tracks file→file dependencies
- **Blast radius analysis** — BFS traversal to find what would break if you change a file
- **MCP Prompts** — 5 guided workflows (`/nova_explore`, `/nova_find`, `/nova_file`, `/nova_review`, `/nova_usage`)
- **Usage dashboard** — tracks Claude Code token consumption and estimated API cost in real time, with cache analytics and task category breakdown
- **Token breakdown** — see where tokens go: by task category (coding, debugging, feature…), MCP server, and core tool — inspired by [codeburn](https://github.com/AgentSeal/codeburn)
- **Index integrity checker** — automatically purges orphaned chunks and stale meta entries at every startup
- **Auto-reindex hook** — keeps the index fresh automatically after every Write/Edit
- **AST exploration**: file tree, symbol outlines, source extraction — zero API calls
- **Context-aware**: imports, sibling symbols, and TODO/FIXME warnings included automatically
- **Incremental indexing**: only changed files are re-embedded
- **Safe by default**: no auto-indexing until you explicitly run `reindex` for the first time
- **Auto-indexing** on subsequent startups (opt-in via `.stellarisrc`)
- **23 file extensions**: TS, JS, Python, Go, Rust, PHP, HTML, CSS, Astro, Vue, Svelte, SCSS, JSON, YAML, SQL, GraphQL, Prisma, TOML, and more
- **Graceful degradation**: works without `OPENAI_API_KEY` (AST tools still available)

## Benchmark: Stellaris vs Grep/Glob

Tested on a real-world Astro project (341 files, 430 chunks indexed):

| Metric | Without Stellaris | With Stellaris | Improvement |
|--------|-------------------|----------------|-------------|
| Tool calls (avg) | 5.0 | **1.5** | **-70%** |
| Full files read (avg) | 2.8 | **0** | **-100%** |
| Tokens consumed | ~12 000 | ~**2 500** | **-80%** |
| Precision | Variable (noisy grep results) | **High** (targeted previews) | |

Stellaris excels at complex multi-file questions (auth flows, payment logic, i18n systems). Grep/Glob remain better for exhaustive file listings. Best strategy: **Stellaris first, Grep/Glob as complement**.

## Tools (14)

### Semantic search (requires OpenAI API key)

| Tool | Description |
|------|-------------|
| `search_code` | Hybrid search (FTS + vector + RRF) in code files. Returns files, lines, previews, and `search_mode`. Accepts optional `extensions` filter. |
| `search_docs` | Hybrid search in Markdown documentation. |
| `reindex` | Incremental re-indexing of the project. Builds vector index, FTS index, and dependency graph. |
| `reindex_file` | Re-index a single file by absolute path. Used by auto-reindex hooks after edits. |

### Structural exploration (no API calls)

| Tool | Description |
|------|-------------|
| `get_file_tree` | Project file tree with language stats. |
| `get_file_outline` | List symbols in a file with line ranges + imports, exports, and TODO/FIXME warnings. |
| `get_symbol` | Full source code of a specific symbol + surrounding file context (imports, siblings, warnings). |

### Dependency graph (no API calls)

| Tool | Description |
|------|-------------|
| `get_dependencies` | Files that a given file imports. Supports `depth` parameter for transitive traversal. |
| `get_dependents` | Files that import a given file (reverse dependencies). |
| `get_blast_radius` | BFS impact analysis: finds all files transitively affected by changes to a file. Returns severity (LOW/MEDIUM/HIGH) and files grouped by depth. |

### Usage tracking (no API calls)

| Tool | Description |
|------|-------------|
| `usage_stats` | Token consumption and estimated API cost. Group by `model`, `project`, `day`, `cache`, `anomaly`, `category`, `mcp`, or `core_tool`. |
| `usage_dashboard` | Launches a local web dashboard (port 8090) with interactive charts, session breakdown, cache analytics, and Breakdown tab. |
| `usage_breakdown` | Structured Markdown report: task category breakdown, MCP server breakdown, core tool breakdown. Accepts `period` parameter. |

## MCP Prompts

Type `/nova` in Claude Code to access guided workflows:

| Prompt | Description |
|--------|-------------|
| `/nova_explore` | Full codebase walkthrough — file_tree → search → outline → symbol |
| `/nova_find` | Locate how a feature is implemented (semantic → drill-down) |
| `/nova_file` | Deep-dive into a specific file — outline + key symbols |
| `/nova_review` | Review recently changed files and assess their blast radius |
| `/nova_usage` | Show token consumption stats and open the interactive usage dashboard |

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

1. **`reindex`** — index the project for the first time (builds vector, FTS, and graph indexes)
2. **`get_file_tree`** — discover the project structure
3. **`search_code`** — find features by natural language description (hybrid search)
4. **`get_file_outline`** — view symbols + imports/exports in a matched file
5. **`get_symbol`** — retrieve exact source code with surrounding context

Or use `/nova_explore` to run steps 2–5 as a guided workflow.

**Impact analysis workflow:**
1. **`get_dependents`** — find who imports a file you're about to change
2. **`get_blast_radius`** — get full transitive impact before making changes
3. **`get_dependencies`** — understand what a file relies on

Steps 2, 4, 5, and all graph tools consume **zero API tokens**.

After the first `reindex`, a `.stellarisrc` file is created in the project root with `auto_index=true`. Subsequent server startups will automatically run incremental indexing (only changed files).

### Auto-reindex hook

To keep the index fresh in real time during Claude Code sessions, add this to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node \"/path/to/stellaris-code-search/scripts/reindex-file.mjs\" \"$file_path\" 2>&1 || true",
        "timeout": 30
      }]
    }]
  }
}
```

Replace `/path/to/stellaris-code-search` with the actual path to your Stellaris installation.

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

## Security

Stellaris **never indexes sensitive files**. Two layers of protection ensure secrets are never sent to OpenAI:

1. **Glob exclusions** (`DEFAULT_EXCLUDE`) — files matching these patterns are never scanned:
   - `.env*`, `secrets.*`, `credentials.*`
   - `*.pem`, `*.key`, `*.cert`, `*.p12`, `*.pfx`, `*.keystore`

2. **Ignore filter** (defense in depth) — same patterns applied via the `ignore` library during file scanning, as a second safety net.

Additionally, `.gitignore` and `.vectorignore` rules are always respected.

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

## Supported languages & formats

| Language / Format | Extensions | Parsing | Symbol types |
|-------------------|-----------|---------|--------------|
| TypeScript | `.ts` | tree-sitter (AST) | function, component, hook, class, type |
| TSX | `.tsx` | tree-sitter (AST) | function, component, hook, class, type |
| JavaScript | `.js` | tree-sitter (AST) | function, component, class |
| JSX | `.jsx` | tree-sitter (AST) | function, component, class |
| Python | `.py` | tree-sitter (AST) | function, class |
| Go | `.go` | tree-sitter (AST) | function, method, type |
| Rust | `.rs` | tree-sitter (AST) | function, struct, impl, trait, type |
| PHP | `.php` | tree-sitter (AST) | function, class, type |
| HTML | `.html` | tree-sitter (AST) | element |
| CSS | `.css` | tree-sitter (AST) | rule |
| Astro | `.astro` | fallback (chunked) | module |
| Vue | `.vue` | fallback (chunked) | module |
| Svelte | `.svelte` | fallback (chunked) | module |
| SCSS / Less | `.scss`, `.less` | fallback (chunked) | module |
| JSON | `.json` | fallback (chunked) | module |
| YAML | `.yaml`, `.yml` | fallback (chunked) | module |
| SQL | `.sql` | fallback (chunked) | module |
| GraphQL | `.graphql`, `.gql` | fallback (chunked) | module |
| Prisma | `.prisma` | fallback (chunked) | module |
| TOML | `.toml` | fallback (chunked) | module |
| Markdown | `.md`, `.mdx` | heading-based | doc_section |

## Architecture

```
src/
  index.ts              # MCP entry point, tool + prompt registration
  startup.ts            # Auto-indexing on startup (reads .stellarisrc)
  prompts.ts            # MCP Prompts definitions (nova_explore, nova_find, nova_usage, ...)
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
    fts.ts              # SQLite FTS5 full-text index
  search/
    hybrid.ts           # RRF fusion of vector + FTS results
  graph/
    resolver.ts         # Import string → real file path resolution
    store.ts            # SQLite dependency graph (graph.db)
    blast.ts            # BFS blast radius + dependency chain
  tools/
    searchCode.ts       # search_code tool (hybrid)
    searchDocs.ts       # search_docs tool (hybrid)
    reindex.ts          # reindex + reindex_file tools
    getFileTree.ts      # get_file_tree tool
    getFileOutline.ts   # get_file_outline tool
    getSymbol.ts        # get_symbol tool
    getDependencies.ts  # get_dependencies tool
    getDependents.ts    # get_dependents tool
    getBlastRadius.ts   # get_blast_radius tool
    usageStats.ts       # usage_stats tool (group_by: model/project/day/cache/anomaly/category/mcp/core_tool)
    usageDashboard.ts   # usage_dashboard tool + HTTP server
    usageBreakdown.ts   # usage_breakdown tool (Markdown report)
  usage/
    scanner.ts          # JSONL scanner — global dedup by message.id, MCP/core split, classifier
    store.ts            # SQLite schema: turns, sessions, processed_files + v3.9 columns
    pricing.ts          # Per-model pricing table (April 2026)
    classifier.ts       # 13-category heuristic classifier (bilingual FR+EN)
    dashboard.ts        # Interactive HTML dashboard renderer (5 tabs incl. Breakdown)
  indexer/
    integrity.ts        # Startup integrity check: orphan purge + stale meta cleanup
scripts/
  reindex-file.mjs      # Hook script for auto-reindex after Write/Edit
```

## Storage

The index is stored in `.vectors/` at the project root:
- `.vectors/lancedb/` — LanceDB vector database (embeddings)
- `.vectors/fts.db` — SQLite FTS5 full-text index
- `.vectors/graph.db` — SQLite dependency graph
- `.vectors/meta.json` — file meta-index (hashes, chunk IDs, timestamps)

This directory is automatically excluded from scanning.

Usage data is stored globally in `~/.claude/usage.db` (SQLite). Data older than 180 days is automatically purged at startup. The dashboard shows the last 90 days.

At every startup, an **integrity check** runs automatically:
- Orphaned chunks (in LanceDB/FTS/graph but absent from `meta.json`) are purged from all 3 stores
- Stale `meta.json` entries (source file deleted from disk) are removed so the next reindex handles them correctly

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm run watch  # Watch mode compilation
```

## License

[MIT](LICENSE)
