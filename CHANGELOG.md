# Changelog

## [2.3.0] - 2026-03-06

### Added
- **`extensions` filter** on `search_code` — optional parameter to restrict results by file type (e.g., `[".ts", ".js"]`), reducing noise from content files (JSON, YAML, i18n)
- **Benchmark section** in README (EN + FR) with real-world test results: -70% tool calls, -80% tokens, -100% full file reads

### Changed
- `search_code` over-fetches 3x when filtering by extension, then trims to requested limit for better relevance

## [2.2.0] - 2026-03-06

### Added
- **13 new file extensions** for indexing: `.astro`, `.vue`, `.svelte`, `.scss`, `.less`, `.json`, `.yaml`, `.yml`, `.sql`, `.graphql`, `.gql`, `.prisma`, `.toml`
- Full coverage of modern web frameworks (Astro, Vue, Svelte) and common config/data formats

### Changed
- `SUPPORTED_EXTENSIONS.code` expanded from 10 to 23 extensions

## [2.1.0] - 2026-03-05

### Added
- **`.stellarisrc`** — per-project configuration file for auto-indexing control
- **`enable_auto_index`** parameter on `reindex` tool to toggle auto-indexing
- **NO_INDEX error** on `search_code` and `search_docs` when no index exists, guiding users to run `reindex` first

### Changed
- **No more auto-indexing by default** — the server no longer indexes the codebase on startup without explicit consent
- After the first successful `reindex`, `.stellarisrc` is created with `auto_index=true` for subsequent startups
- `OPENAI_API_KEY` description updated: marked as optional (required only for search/indexing)

### Security
- Prevents unintended code submission to OpenAI API when the MCP server is installed globally

## [2.0.0] - 2025-03-05

### Added
- **3 new AST-based tools** (zero API calls):
  - `get_file_tree` — project file tree with stats
  - `get_file_outline` — symbol hierarchy + imports/exports + TODO/FIXME warnings
  - `get_symbol` — full source code + file context (imports, sibling symbols, warnings)
- **Context-aware design**: `get_symbol` includes file-level context by default to prevent blind refactoring errors. Controllable via `context: false` parameter.
- **`extractFileContext()`** — new internal function that extracts imports, exports, all symbol names, and TODO/FIXME/HACK/NOTE/@deprecated comments
- **6 new languages**: Python, Go, Rust, PHP, HTML, CSS
- Multi-language AST chunker with per-language symbol extraction
- Graceful degradation: server starts without `OPENAI_API_KEY` (AST tools still work)
- README (EN + FR), LICENSE (MIT), CHANGELOG, .gitignore

### Changed
- `OPENAI_API_KEY` is no longer required at startup — only needed for semantic search tools
- Auto-indexing skipped when API key is absent
- Chunker rewritten with pluggable language config architecture

## [1.0.0] - 2025-02-01

### Added
- Initial release
- `search_code` — semantic code search via OpenAI embeddings + LanceDB
- `search_docs` — semantic documentation search
- `reindex` — incremental project indexing
- TypeScript/JavaScript/TSX/JSX support via tree-sitter
- Markdown documentation indexing
- Auto-indexing on server startup
- Incremental indexing via SHA-256 file hashing
