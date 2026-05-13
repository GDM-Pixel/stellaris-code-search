# Changelog

## [4.4.0] - 2026-05-13

### Added — Context overflow protection (inspiré de codegraph-rust)

- **`src/utils/responseTier.ts`** — nouveau module de tier-aware response sizing :
  - 4 paliers basés sur `STELLARIS_CONTEXT_WINDOW` (défaut 128K) : `small` (<50K), `medium` (50–150K), `large` (150–500K), `massive` (>500K)
  - Chaque tier impose : `defaultLimit`, `maxLimit`, `maxResultBytes`, `maxGraphDepth`
  - `truncateIfOversized(result, arrayFields)` — tronque les tableaux à la fin et injecte `_truncated: { truncated_items, original_count, fields, tier, max_bytes, hint }` pour signaler explicitement au LLM appelant qu'il a reçu des données partielles
  - `clampLimit(userLimit)` — clamp un `limit` utilisateur au `maxLimit` du tier courant
- **Branché dans 7 outils à risque d'overflow** : `search_code`, `get_blast_radius`, `get_dependencies`, `get_dependents`, `get_dead_code`, `get_circular_deps`, `get_most_coupled`
- **Pourquoi** : sans garde, `get_blast_radius` sur un hub très importé pouvait silencieusement renvoyer plusieurs centaines de KB de JSON et faire déborder le contexte du LLM appelant. Désormais le tier `medium` (défaut) coupe à 80 KB et le LLM voit `_truncated.hint` pour réduire son `limit`.

### Added — Architecture boundaries enforcement

- **`stellaris.boundaries.json`** au root du projet — règles de couches imposées à l'indexation :
  ```json
  { "deny": [{ "from": "src/ui/**", "to": "src/db/**", "reason": "UI must not touch DB" }] }
  ```
  Patterns glob-style (`**`, `*`, `?`). Aucun runtime cost : la détection se fait pendant l'indexation, les violations sont stockées dans `graph.db`.
- **Nouveau tool** : `get_boundary_violations` — groupe les violations par règle, top 5 exemples par règle, plein détail dans `violations[]`.
- **Tables ajoutées** dans `graph.db` : `boundary_violations` (source, target, rule_name, from_pattern, to_pattern, reason).
- **Cohérence sur edit incrémental** : `reindex_file` re-check les boundaries du fichier modifié; `deleteBoundaryViolations` purge les violations à la suppression.

### Added — Doc/spec linking

- **`src/graph/docLinker.ts`** — extrait les identifiants entre backticks (\`UserService\`, \`handleAuth\`) dans les fichiers markdown et les relie au fichier de définition du symbole correspondant (via l'index des chunks FTS).
- **Nouveau tool** : `find_doc_references` — répond à "quels markdown référencent ce symbole / ce fichier ?". Utile avant de renommer ou supprimer un symbole documenté.
- **Heuristiques anti-bruit** : skip des fenced code blocks, filtre stopwords (true/false/the/…), exigence d'une majuscule/underscore/point sauf si le mot fait ≥4 caractères.
- **Table ajoutée** : `doc_links` (doc_file, symbol, target_file, line_number).

### Notes d'implémentation

- Inspiré de [codegraph-rust](https://github.com/Jakedismo/codegraph-rust) — adapté pour TypeScript/SQLite. Volontairement **pas** porté : agents internes Rig/LATS/Reflexion (le LLM est côté client MCP), SurrealDB (over-engineering pour notre échelle), reranking ML par-défaut, dataflow edges Rust-only.
- 2 nouveaux outils, 4 nouvelles tables/colonnes, 0 breaking change. Les `meta.json` et indexes existants restent compatibles.

## [4.3.0] - 2026-04-25

### Added — Embedding providers pluggables (P0)

- **Multi-provider embeddings** — Stellaris n'est plus OpenAI-only. Nouveau système factory dans `src/indexer/providers/` :
  - `openai.ts` — `text-embedding-3-small` (défaut, 1536 dims)
  - `voyage.ts` — `voyage-code-3` (1024 dims) — mesuré supérieur à OpenAI small sur du code
  - `ollama.ts` — `nomic-embed-text` (768 dims) — 100% local, zéro réseau
- **Configuration** : via env var `EMBEDDING_PROVIDER=openai|voyage|ollama` ou `.stellarisrc` (`embedding_provider`, `embedding_model`)
- **Garde-fou anti-corruption** — `_index_config` (provider + model + dims) sauvegardé dans `meta.json`. Si le provider change entre deux runs, Stellaris refuse le reindex incrémental et demande `force=true`. Évite la corruption silencieuse de LanceDB (table typée sur les dims).
- **Dims dynamique** — LanceDB détecte et recrée la table si les dims changent (changement de provider). Pass-through propre depuis `addChunks` et `searchByVector`.
- **`reindex` tool** — nouveau paramètre `force: boolean`. Avec `force=true`, supprime LanceDB + meta.json avant de reindexer (requis après un changement de provider).

### Added — Re-ranking optionnel (P2)

- **`src/search/reranker.ts`** — re-ranker cross-encoder post-RRF :
  - `RERANK_PROVIDER=voyage` → Voyage `rerank-2` (recommandé)
  - `RERANK_PROVIDER=cohere` → Cohere `rerank-v3.5`
  - `off` (défaut) — comportement identique à avant
- Branché dans `hybrid.ts` après la fusion RRF : passe les top-N×2 candidats au reranker, retourne les top-N reranked.
- Fallback silencieux sur l'ordre RRF si l'appel reranker échoue.
- Amélioration de pertinence top-5 estimée : +15-30% (mesuré sur Voyage rerank-2 vs RRF seul).

### Added — Java + Ruby (P1)

- **`tree-sitter-java`** + **`tree-sitter-ruby`** ajoutés aux dépendances
- Parsing AST natif pour `.java` (classes, interfaces, enums, annotations) et `.rb` (classes, modules, méthodes)
- Import extraction : `import com.example.Foo` (Java), `require` / `require_relative` (Ruby)
- Extensions `.java`, `.rb` ajoutées à `SUPPORTED_EXTENSIONS` — indexées automatiquement

### Architecture

```
src/
  indexer/
    providers/
      base.ts        # NEW — interface EmbeddingProvider + retry helper
      openai.ts      # NEW — provider OpenAI (extrait de embedder.ts)
      voyage.ts      # NEW — provider Voyage AI
      ollama.ts      # NEW — provider Ollama (local)
    embedder.ts      # REFACTORED — factory + LRU cache générique
    hasher.ts        # EXTENDED — _index_config sentinel + saveIndexConfig/getStoredIndexConfig
  search/
    reranker.ts      # NEW — Voyage / Cohere re-ranking post-RRF
    hybrid.ts        # EXTENDED — appel reranker optionnel après RRF
  config/
    defaults.ts      # EXTENDED — EmbeddingProviderName, Java/Ruby extensions
    stellarisrc.ts   # EXTENDED — embedding_provider, embedding_model, rerank_provider
  store/
    lancedb.ts       # EXTENDED — dims dynamique, drop+recreate si dims change
  tools/
    reindex.ts       # EXTENDED — garde-fou config, force=true, saveIndexConfig
```

## [4.0.0] - 2026-04-17

### Added — Token-efficient exploration (inspired by claude-mem)

- **`get_file_folded` tool** — new AST-based tool returning all symbols with signatures + JSDoc but NO function bodies, under a configurable `token_budget` (default 4000). When budget is exceeded, symbols are dropped tail-first and `truncated: true` is flagged. Bridges the gap between `get_file_outline` (200 tokens, symbol names only) and `get_symbol` (full source of one symbol). Zero API required — purely tree-sitter.
- **Progressive disclosure descriptions** — `search_code`, `get_file_outline`, `get_file_folded`, `get_symbol` descriptions now explicitly enforce a token-efficient 4-step workflow: search index → outline → folded → symbol. Claude is instructed never to `Read` a file after `search_code`. Non-breaking.

### Added — Claude Code hook integration

- **`session_briefing` tool** — returns a condensed markdown briefing of project state: graph health summary, top cycle, and recent git activity with blast-radius ranking. Target: <800 tokens. Degrades gracefully if git history or graph index is missing.
- **`scripts/session-start.mjs`** — Claude Code `SessionStart` hook script. Emits the briefing on stdout (injected into session context) with a 3s timeout. Silently exits if Stellaris is not built or if the current directory is not a git project.
- **`detect_significant_changes` tool** — heuristic detector that scores a session as "significant" if git diff exceeds thresholds (100 lines or 5 files) or the graph has circular dependencies. Returns signals + recommendation to call `nova-mind-cloud storeMemory`.
- **`scripts/session-stop.mjs`** — Claude Code `Stop` hook script. When significance is detected, emits a structured reminder on stdout nudging the assistant to memorize the technical work via `nova-mind-cloud storeMemory` (category `technical.development`). Never calls storeMemory itself — only prompts.

### Design philosophy

- **Stellaris stays a code-brain, nova-mind-cloud stays the memory-brain.** No local observation store added — we explicitly rejected duplicating `nova-mind-cloud` (Supabase pgvector + Knowledge Graph) in a local SQLite. Stellaris becomes the **technical sensor** that feeds nova-mind-cloud when pertinent, not a parallel memory system.

### Architecture

```
src/
  tools/
    getFileFolded.ts              # NEW — folded structural view with token budget
    sessionBriefing.ts            # NEW — SessionStart briefing composer
    detectSignificantChanges.ts   # NEW — Stop hook detector
scripts/
  session-start.mjs               # NEW — SessionStart hook
  session-stop.mjs                # NEW — Stop hook
```

### Activation (user-side `~/.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /path/to/stellaris/scripts/session-start.mjs" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "node /path/to/stellaris/scripts/session-stop.mjs"  }] }]
  }
}
```

### Deferred to v4.1.0

- **Unified HTTP worker** (replacing ephemeral dashboards on ports 8090/8091) — requires deeper refactor of `usageDashboard` and `graphView`, deferred to avoid risk to stable dashboards in v4.0.0.

## [3.9.1] - 2026-04-14

### Fixed
- **Dashboard Breakdown tab**: `turn_count` was always 0 for most categories because `queryCategoryBreakdown` filtered on `stop_reason IN ('end_turn','stop_sequence')`, excluding all turns that ended with `tool_use`. Fixed with `COUNT(*)`.
- **Category migration**: the v3.9.0 migration added `category`/`core_tools`/`mcp_tools` columns but did not clear `turns` and `processed_files`, so existing rows kept their `DEFAULT 'general'` value without ever being re-classified. Migration now wipes `turns`, `sessions`, and `processed_files` to force a full rescan on first startup.
- **Donut legend text**: `CAT_ICONS[r.category] || '📌' + ' ' + label` was parsed as `CAT_ICONS[r.category] || ('📌 ' + label)` due to operator precedence — icon was shown without label. Fixed with explicit parentheses.
- **Legend text color**: `generateLabels` override on Chart.js ignores `labels.color`. Added `fontColor: '#c9cfc1'` directly on each generated label item.
- **Cache donut**: all segments were the same green (all models had hit_ratio ≥ 0.7). Changed to a distinct per-model color palette; donut now shows `cache_read` volume per model. Legend shows `model — hit XX%`, tooltip shows cache read volume and hit ratio.
- **Cache donut syntax error**: missing closing brace in `options.plugins` caused `Unexpected token ')'` and crashed the entire dashboard JS.

## [3.9.0] - 2026-04-14

### Added
- **`usage_breakdown` tool** — new MCP tool returning a structured Markdown report with three sections: task category breakdown, MCP server breakdown, and core tool breakdown. Accepts `period` parameter (`today`, `7d`, `30d`, `all`). Inspired by [AgentSeal/codeburn](https://github.com/AgentSeal/codeburn).
- **Task category classification** (`src/usage/classifier.ts`) — heuristic classifier assigning each Claude Code turn to one of 13 categories: `coding`, `debugging`, `feature`, `refactoring`, `testing`, `exploration`, `planning`, `delegation`, `git`, `build_deploy`, `conversation`, `brainstorming`, `general`. Classification order: agent spawn → plan mode → edit+keywords → read-only → bash+keywords → MCP-only → brainstorm keywords → no tools → fallback. Bilingual FR+EN regex patterns.
- **Global dedup by `message.id`** (`src/usage/scanner.ts`) — a shared `Set<string>` across all JSONL files prevents double-counting when sessions are resumed (`/resume`). The `message_id` column has a `UNIQUE` constraint at DB level as a second safety net.
- **MCP / core tool split** — scanner now extracts `mcp_tools` (array of `{server, tool}` from `mcp__<server>__<tool>` names) and `core_tools` (all other tools) per turn.
- **`usage_stats` extended** — `group_by` now accepts `category`, `mcp`, and `core_tool` in addition to the existing `model`, `project`, `day`, `cache`, `anomaly`.
- **Dashboard "Breakdown" tab** — new tab with doughnut chart of task categories, category table, horizontal bar chart of top MCP servers, and top 15 core tools table.
- **New DB columns on `turns`**: `message_id`, `user_message_preview`, `core_tools`, `mcp_tools`, `web_search_requests`, `speed`, `category`, `user_parent_ts` — all added via idempotent `ALTER TABLE` migrations.

### Architecture
```
src/
  usage/
    classifier.ts       # NEW — 13-category heuristic classifier (bilingual FR+EN)
  tools/
    usageBreakdown.ts   # NEW — usage_breakdown MCP tool
```

## [3.6.0] - 2026-04-11

### Added
- **5 new MCP tools** for deep graph analysis:
  - `get_circular_deps` — Tarjan's SCC algorithm to detect all circular dependency cycles
  - `get_dead_code` — identifies files never imported by others (unreferenced code candidates)
  - `get_topological_order` — Kahn's algorithm to order files for safe sequential refactoring
  - `simulate_move` — computes the full import migration plan before moving/renaming a file
  - `get_most_coupled` — ranks files by combined in+out degree to identify coupling hotspots

- **Graph View 3D dashboard v2** — major sidebar and controls update:
  - **Left sidebar resizable** via drag handle (clamp 150px–500px)
  - **View Mode** dropdown with 7 visualization modes: Language, Directory, Degree, Impact Analysis, Dead Code, Circular Deps, Most Coupled
  - **Display section**: Node Size slider, Edge Width slider, Link Opacity slider, Curved edges toggle
  - **Physics section**: Charge strength slider, Link distance slider (with live `d3ReheatSimulation`)
  - **Camera presets**: Top / Front / Side / Reset buttons + animated transitions
  - **Screenshot export**: exports current graph view as PNG
  - **Folder tree**: collapsible file tree built from node paths — click to highlight folder, double-click to filter graph, single-file click opens detail panel
  - **Depth slider UX fix**: disabled with tooltip when no search term, re-runs BFS on change
  - **nodeOpacity as function**: folder highlight dims non-selected nodes to 0.12

### Architecture
```
src/
  graph/
    cycles.ts           # Tarjan's SCC (detectCycles)
    topology.ts         # Kahn's topological sort (computeTopologicalOrder)
    graphDashboard.ts   # dashboard v2 (~900 lines)
  tools/
    getCircularDeps.ts
    getDeadCode.ts
    getTopologicalOrder.ts
    simulateMove.ts
    getMostCoupled.ts
```

## [3.5.0] - 2026-04-11

### Added
- **Graph View 3D** — new `graph_view` MCP tool launching a local HTTP server (port 8091) with an interactive 3D dependency graph visualization
  - Files rendered as colored spheres grouped by language (TypeScript blue, Python blue-green, Go cyan, Rust orange, Vue green, etc.)
  - Directed edges with arrows showing import direction
  - **Hover**: highlights neighboring nodes and edges, tooltip shows in/out-degree
  - **Click**: opens a file detail panel with in/out-degree, list of imports (clickable to navigate), symbol outline (via AST), and "Open in VS Code" button (`vscode://file/...`)
  - **Sidebar filters**: search by filename (BFS subgraph focus with adjustable depth 1–5), hide node_modules toggle, per-extension toggles with language colors
  - Node size proportional to total degree (min 1, max 8)
  - Dark theme Nova Mind (same visual identity as usage_dashboard)
  - Reuses existing `graph.db` — zero extra indexing required

### Architecture
```
src/
  graph/
    export.ts          # getAllEdges → {nodes, links, stats} with in/out-degree per node
    graphDashboard.ts  # HTML/CSS/JS template (3d-force-graph CDN, ~430 lines)
  tools/
    graphView.ts       # graph_view handler + HTTP server (routes: /, /api/data, /api/file-outline)
```

### Dependencies
- `3d-force-graph@1.73.3` loaded via CDN (Three.js bundled) — no new npm dependency

## [3.4.0] - 2026-04-09

### Added
- **DB Schema Awareness** — 3 new MCP tools giving the LLM instant access to the project's database schema, without guessing or tâtonnement
  - `db_snapshot` — introspects a live database (PostgreSQL/Supabase/Neon) via connection string and saves a normalized snapshot to `.vectors/db-schema.json`. Falls back to parsing local schema files (`database.types.ts`, `prisma/schema.prisma`) when no credentials are available
  - `db_schema` — reads the local snapshot with zero latency and zero DB connection. Supports `compact` (default), `full` JSON, and `sql` DDL output formats. Accepts a `table` filter and an optional staleness warning (>24h)
  - `db_search` — keyword search across table names, column names, types, comments, and enum values using a natural language query (e.g. `"image generation settings"`, `"user permissions"`)
- **`nova_db` prompt** — guided workflow that calls `db_schema` + `db_search` and explains the data model, relationships, and RLS policies in context
- **PostgreSQL provider** — full introspection via `information_schema` + `pg_catalog` + `pg_policies`: tables, columns, primary keys, unique constraints, indexes, foreign keys, enums, RLS policies, row count estimates, and column/table comments. SSL-enabled by default
- **Supabase types parser** — parses `database.types.ts` (generated by `supabase gen types`) into a normalized `DbSchema` when no live connection is available
- **Prisma schema parser** — parses `schema.prisma` (models, enums, field types, `@relation`) into `DbSchema` with automatic PascalCase → snake_case table name conversion
- **Auto-maintenance** — `db_auto_snapshot=true` in `.stellarisrc` triggers a schema refresh on every Stellaris startup (non-blocking, runs in background alongside `autoIndex`)
- **Env var support** — `DB_CONNECTION_STRING` and `DATABASE_URL` environment variables are read automatically by `db_snapshot`, avoiding plaintext credentials in config files

### Changed
- **`.stellarisrc`** extended with 4 new optional fields: `db_connection_string`, `db_provider`, `db_auto_snapshot`, `db_schemas`
- **`package.json`** — added `pg ^8.13.0` (runtime, dynamically imported) and `@types/pg ^8.11.10` (dev) for PostgreSQL driver

### Architecture
```
src/
  db/
    types.ts               # Normalized interfaces: DbSchema, DbTable, DbColumn, DbIndex, DbForeignKey, DbRlsPolicy, DbEnum
    schema-store.ts        # read/write .vectors/db-schema.json
    snapshot.ts            # Orchestrator: detect provider → introspect → save
    providers/
      base.ts              # DbProvider interface
      detect.ts            # Auto-detect provider from connection string + maskConnectionString()
      postgres.ts          # PostgreSQL adapter (full introspection)
    parsers/
      detect.ts            # Auto-detect local schema files (database.types.ts, schema.prisma)
      supabase-types.ts    # Parse Supabase generated types
      prisma.ts            # Parse Prisma schema
  tools/
    dbSnapshot.ts          # db_snapshot handler
    dbSchema.ts            # db_schema handler (compact/full/sql formats)
    dbSearch.ts            # db_search handler (keyword scoring + dedup)
```

## [3.3.0] - 2026-04-08

### Added
- **Index integrity checker** — runs automatically at every startup after `autoIndex`, no API key required
  - Detects **orphaned chunks**: file paths present in FTS/LanceDB/graph but absent from `meta.json` (caused by crashes mid-reindex or manual edits to `.vectors/`). Purges all 3 stores.
  - Detects **stale meta entries**: paths in `meta.json` whose source file no longer exists on disk. Removes them so `findChangedFiles()` treats them as deleted on the next reindex.
  - New `getIndexedFilePaths()` function in `store/fts.ts` used as source of truth for orphan detection

### Fixed (robustness & performance)
- **Graceful shutdown**: `shutdown()` in `index.ts` now stops the usage watcher, closes the graph SQLite connection (WAL flush), and releases the LanceDB connection handle
- **Atomic `meta.json` write**: uses `.tmp` → `rename` to prevent index corruption on crash mid-write
- **Crash-safe reindex**: meta is saved before the embedding pass — a crash during embedding leaves no orphaned old chunks (the integrity checker will catch any residuals)
- **`getFileOutline` cache**: mtime-based LRU cache (200 entries) — avoids re-reading + re-parsing AST on repeated calls to unchanged files
- **Usage watcher debounce**: 500ms → 2s to coalesce event bursts on large project trees (1500+ JSONL files)
- **`strip-json-comments`**: replaces regex-based comment stripping in `graph/resolver.ts` for correct tsconfig.json parsing (handles `//` inside strings, multiline `/* */`)
- **LanceDB `closeLanceStore()`**: releases connection reference on shutdown

### Architecture
```
src/
  indexer/
    integrity.ts    # Orphan detection + stale meta cleanup (new)
```

## [3.2.0] - 2026-04-08

### Added
- **Claude Code usage dashboard** — new `usage_stats` and `usage_dashboard` tools for tracking token consumption and API cost
  - `usage_stats` — token usage by model/project/day for today, 7d, 30d, or all time. Shows cache read, input/output tokens, estimated API value (what Anthropic absorbs for Max subscribers), and turn count
  - `usage_dashboard` — launches a local HTTP server (port 8090) with an interactive web dashboard: daily charts, per-session breakdown, model comparison, and cost evolution over 90 days
  - Nova Mind Cloud visual identity: dark theme, cerise/blue accents, Inter+Poppins fonts
- **`/nova_usage` prompt** — one-command shortcut that calls `usage_stats`, opens the dashboard, and formats results for Claude Code

### Fixed
- **Critical: tool_use entries missing from cost calculation** — the unique constraint on `turns` was `(session_id, timestamp, model)` without `stop_reason`. Since `tool_use` and `end_turn` can share the same timestamp, `INSERT OR IGNORE` was silently discarding `tool_use` rows — the entries that carry ~80% of `cache_read_input_tokens`. Fixed by adding `stop_reason` to the unique key
- **Startup migration deleting tool_use rows** — the previous migration purged all turns with `stop_reason NOT IN ('end_turn', 'stop_sequence')`, destroying cache token data. Now only streaming fragments (null/empty stop_reason) are purged; `tool_use` entries are retained for accurate token accounting
- **Turn counting inflated** — raw JSONL lines were being counted as turns. Now only `end_turn` and `stop_sequence` lines count as visible turns (via `CASE WHEN` in SQL); `tool_use` lines are stored for token tracking only
- **Wrong Opus pricing** — `claude-opus-4-6` was priced at $15/$75 (Opus 4-1 rates). Corrected to $5/$25 (Opus 4.x rates)

### Changed
- **Data retention** — turns older than 180 days are automatically purged at startup. The dashboard shows 90 days max, so data beyond 180 days has no display value. `processed_files` entries are retained to prevent re-scanning old JSONL files

### Architecture
```
src/
  tools/
    usageStats.ts       # usage_stats MCP tool
    usageDashboard.ts   # usage_dashboard MCP tool + HTTP server
  usage/
    scanner.ts          # JSONL scanner with FileWatcher (incremental)
    store.ts            # SQLite schema (turns, sessions, processed_files)
    pricing.ts          # Per-model pricing table (April 2026)
    dashboard.ts        # HTML/CSS/JS dashboard renderer
```

## [3.0.0] - 2026-04-08

### Added
- **MCP Prompts** — 4 guided workflows accessible via `/nova_*` in Claude Code:
  - `nova_explore` — full codebase walkthrough (file_tree → search → outline → symbol)
  - `nova_find` — locate a feature's implementation by natural language description
  - `nova_file` — deep-dive into a specific file (outline + key symbols)
  - `nova_review` — review recently changed files and assess their impact
- **`💡 Next steps` hints** — every tool response now suggests the most useful follow-up tool call, guiding Claude through the recommended workflow
- **`reindex_file` tool** — re-index a single file after editing, much faster than a full `reindex`. Used by auto-reindex hooks
- **Auto-reindex hook** — `PostToolUse` hook for Claude Code's `settings.json` that calls `reindex_file` automatically after every `Write` or `Edit`, keeping the index fresh in real time
- **Hybrid search (FTS + vector + RRF)** — `search_code` and `search_docs` now combine full-text search (SQLite FTS5 BM25) with vector embeddings, merged via Reciprocal Rank Fusion (k=60). Dramatically improves results for exact identifier names (function names, class names, variable names)
  - Query-aware kind boosting: PascalCase → classes, camelCase/snake_case → functions
  - Fallback chain: hybrid → FTS only → LIKE match
  - Results include `search_mode` (`hybrid`/`vector`/`fts`) and `sources` per result
- **Dependency graph** — during `reindex`, imports are resolved to real file paths and stored in a SQLite graph (`graph.db`). Supports TS path aliases, barrel files, and implicit extensions
- **`get_dependencies(file, depth?)` tool** — files that a given file imports, with optional depth traversal
- **`get_dependents(file)` tool** — files that import a given file (reverse dependencies)
- **`get_blast_radius(file, depth?)` tool** — BFS analysis of change impact: finds all files transitively affected, grouped by depth, with severity assessment (LOW/MEDIUM/HIGH)

### Changed
- `search_code` / `search_docs` — replaced pure vector search with hybrid search; search quality improved for exact symbol lookups
- `reindex` — now also builds FTS index (`fts.db`) and dependency graph (`graph.db`) in `.vectors/`
- Tool count: **6 → 10 tools** + **4 MCP prompts**

### Dependencies
- Added `better-sqlite3` for FTS5 index and dependency graph storage

### Migration
Projects indexed with v2.x need a one-time `reindex` to build the new FTS and graph indexes. Existing LanceDB vectors are preserved (incremental).

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
