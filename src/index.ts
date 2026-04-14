#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { handleSearchCode } from './tools/searchCode.js';
import { handleSearchDocs } from './tools/searchDocs.js';
import { handleReindex, handleReindexFile } from './tools/reindex.js';
import { handleGetFileTree } from './tools/getFileTree.js';
import { handleGetFileOutline } from './tools/getFileOutline.js';
import { handleGetSymbol } from './tools/getSymbol.js';
import { handleGetDependencies } from './tools/getDependencies.js';
import { handleGetDependents } from './tools/getDependents.js';
import { handleGetBlastRadius } from './tools/getBlastRadius.js';
import { handleUsageStats } from './tools/usageStats.js';
import { handleUsageDashboard } from './tools/usageDashboard.js';
import { handleUsageAnomalies } from './tools/usageAnomalies.js';
import { handleDbSchema } from './tools/dbSchema.js';
import { handleDbSearch } from './tools/dbSearch.js';
import { handleDbSnapshot } from './tools/dbSnapshot.js';
import { handleGraphView, stopGraphServer } from './tools/graphView.js';
import { handleGetCircularDeps } from './tools/getCircularDeps.js';
import { handleGetDeadCode } from './tools/getDeadCode.js';
import { handleGetTopologicalOrder } from './tools/getTopologicalOrder.js';
import { handleSimulateMove } from './tools/simulateMove.js';
import { handleGetMostCoupled } from './tools/getMostCoupled.js';
import { handleProjectHealth } from './tools/projectHealth.js';
import { handleGraphExport } from './tools/graphExport.js';
import { handleUsageBreakdown } from './tools/usageBreakdown.js';
import { autoIndex, autoScanUsage, autoDbSnapshot } from './startup.js';
import { PROMPTS, getPromptMessages } from './prompts.js';
import { closeGraphStore } from './graph/store.js';
import { closeLanceStore } from './store/lancedb.js';
import { stopWatcher } from './usage/scanner.js';

// Warn if OPENAI_API_KEY is missing (semantic search won't work, but AST tools will)
if (!process.env.OPENAI_API_KEY) {
  console.error('[Stellaris] Warning: OPENAI_API_KEY not set. search_code, search_docs, and reindex will not work. AST tools (get_file_tree, get_file_outline, get_symbol) are still available.');
}

const server = new Server(
  {
    name: 'stellaris-mcp',
    version: '3.9.1',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

// Tool definitions
const TOOLS = [
  {
    name: 'search_code',
    description:
      'Semantic search in code files. Use natural language to find functions, components, hooks, classes, and types. Returns file paths, line numbers, and code previews ranked by relevance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "permission management for projects", "hook that fetches deals")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter results by file extensions (e.g., [".ts", ".js"]). Only returns results from files matching these extensions. Useful to exclude content files (JSON, YAML) when searching for code logic.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_docs',
    description:
      'Semantic search in documentation and markdown files. Finds relevant documentation sections by natural language query. Returns file paths, section headings, and full content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "article publishing workflow", "release process")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'reindex',
    description:
      'Force incremental reindex of the project codebase. Only re-embeds files that have changed since last index. Use this to initialize the index for the first time. After first indexation, auto-index is enabled for subsequent startups via .stellarisrc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Project root path to index (auto-detected from cwd if not provided)',
        },
        enable_auto_index: {
          type: 'boolean',
          description: 'Explicitly enable or disable automatic incremental indexing on startup. Writes to .stellarisrc in the project root.',
        },
      },
    },
  },
  {
    name: 'reindex_file',
    description:
      'Reindex a single file after it has been modified or created. Much faster than a full reindex — use this in hooks after Write/Edit tool calls to keep the index up-to-date in real time. Requires OPENAI_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the modified file (e.g., "/home/user/project/src/foo.ts")',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'get_file_tree',
    description:
      'Get the project file tree structure. Returns all indexed files organized by directory, with stats on languages and file counts. No API call needed — instant response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Project root path (auto-detected from cwd if not provided)',
        },
      },
    },
  },
  {
    name: 'get_file_outline',
    description:
      'Get the symbol outline of a specific file. Lists all top-level functions, classes, types, components, and hooks with their line ranges. Also returns file imports, exports, and any TODO/FIXME warnings. No API call needed — uses AST parsing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Relative file path from project root (e.g., "src/tools/searchCode.ts")',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'get_symbol',
    description:
      'Get the full source code of a specific symbol (function, class, type, etc.) from a file. By default includes file context: imports, exports, sibling symbols, and TODO/FIXME warnings — so the LLM understands the surrounding code without reading the entire file. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Relative file path from project root (e.g., "src/tools/searchCode.ts")',
        },
        name: {
          type: 'string',
          description: 'Symbol name to retrieve (e.g., "handleSearchCode", "SearchResult")',
        },
        context: {
          type: 'boolean',
          description: 'Include file context: imports, exports, sibling symbols, warnings (default: true). Set to false for raw source only.',
        },
      },
      required: ['file', 'name'],
    },
  },
  {
    name: 'get_dependencies',
    description:
      'Get the files that a given file imports (its dependencies). Shows the dependency chain from this file outward. Requires a prior reindex to build the dependency graph. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Relative file path from project root (e.g., "src/tools/searchCode.ts")',
        },
        depth: {
          type: 'number',
          description: 'How many levels deep to traverse (default: 1 = direct imports only, 2 = imports of imports)',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'get_dependents',
    description:
      'Get the files that import a given file (its dependents / reverse dependencies). Shows what other code relies on this file. Requires a prior reindex to build the dependency graph. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Relative file path from project root (e.g., "src/tools/searchCode.ts")',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'get_blast_radius',
    description:
      'Analyze the blast radius of changes to a file: find all files that would be directly or transitively affected. Uses BFS on the dependency graph. Returns severity assessment, impacted files by depth, and edges. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Relative file path from project root (e.g., "src/tools/searchCode.ts")',
        },
        depth: {
          type: 'number',
          description: 'Maximum BFS depth (default: 2). Higher values = wider blast radius but slower.',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'usage_stats',
    description: 'Get Claude Code token usage statistics and estimated API costs. Shows consumption by model, project, or day for a given period. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7d', '30d', 'all'],
          description: 'Time period to query (default: today)',
        },
        group_by: {
          type: 'string',
          enum: ['model', 'project', 'day', 'cache', 'anomaly'],
          description: 'Group results by model, project, day, cache analytics, or session anomalies (default: model)',
        },
      },
    },
  },
  {
    name: 'usage_dashboard',
    description: 'Launch a local web dashboard showing Claude Code token usage with interactive charts. Opens in VS Code Simple Browser. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        port: {
          type: 'number',
          description: 'Port for the local HTTP server (default: 8090)',
        },
      },
    },
  },
  {
    name: 'usage_anomalies',
    description: 'List Claude Code sessions that hit health thresholds: SES001 cost ≥$25, SES002 ≥200 turns, SES003 ≥5M tokens, SES004 idle 7+ days. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7d', '30d', 'all'],
          description: 'Time period to check for anomalies (default: all)',
        },
      },
    },
  },
  {
    name: 'db_snapshot',
    description: 'Introspect a database and save a local schema snapshot to .vectors/db-schema.json. Connects to the DB via a connection string (PostgreSQL supported), or falls back to parsing local schema files (prisma/schema.prisma, database.types.ts). Run this once before using db_schema or db_search.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        connection_string: {
          type: 'string',
          description: 'Database connection URL (e.g., postgresql://user:pass@host:5432/db). If omitted, reads DB_CONNECTION_STRING or DATABASE_URL env vars, or falls back to local ORM file parsing.',
        },
        provider: {
          type: 'string',
          enum: ['postgres', 'mysql', 'sqlite', 'auto'],
          description: 'Database provider. Default: auto (detected from connection string).',
        },
        schemas: {
          type: 'array',
          items: { type: 'string' },
          description: 'DB schemas to introspect (default: ["public"]). Supabase users may want ["public", "auth"].',
        },
        save_connection: {
          type: 'boolean',
          description: 'Save the connection string to .stellarisrc for future startup auto-snapshot (default: false). The .stellarisrc file is gitignored.',
        },
      },
    },
  },
  {
    name: 'db_schema',
    description: 'Read the local database schema snapshot. Returns tables, columns, types, primary keys, foreign keys, indexes, enums, and RLS policies. No DB connection needed — reads from .vectors/db-schema.json. Run db_snapshot first to create or refresh the snapshot.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: {
          type: 'string',
          description: 'Filter output to a specific table name (e.g. "articles" or "public.articles"). Returns all tables if omitted.',
        },
        format: {
          type: 'string',
          enum: ['compact', 'full', 'sql'],
          description: 'Output format: compact (default, human-readable summary), full (complete JSON), sql (CREATE TABLE DDL).',
        },
        include_indexes: {
          type: 'boolean',
          description: 'Include index definitions in output (default: true)',
        },
        include_policies: {
          type: 'boolean',
          description: 'Include RLS policies in output (default: true)',
        },
      },
    },
  },
  {
    name: 'db_search',
    description: 'Search the database schema by natural language query. Finds tables and columns matching a concept (e.g. "user permissions", "image generation prompts", "article cover"). No DB connection needed — searches the local snapshot.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query (e.g. "tables related to authentication", "columns storing timestamps", "cover image generation settings")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_view',
    description: 'Launch a 3D interactive visualization of the project dependency graph. Shows files as colored nodes (by language) connected by import edges. Supports filtering by file type, focusing on a specific file neighborhood, and clicking nodes to inspect file details and open them in VS Code. Requires a prior reindex to build the dependency graph. Opens in VS Code Simple Browser.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        port: {
          type: 'number',
          description: 'Port for the local HTTP server (default: 8091)',
        },
      },
    },
  },
  {
    name: 'get_circular_deps',
    description: 'Detect circular dependencies in the project using Tarjan\'s SCC algorithm. Returns groups of files that form dependency cycles. Use this before refactoring to identify problematic coupling. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        max_cycles: {
          type: 'number',
          description: 'Maximum number of cycles to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'get_dead_code',
    description: 'Find files that are never imported by any other file (dead code candidates). Excludes known entry points (index, main, config, test files). Use this to identify unused code before cleanup. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        exclude_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional regex patterns for files to exclude (entry points). E.g., ["^src/routes/", "\\.stories\\."]',
        },
      },
    },
  },
  {
    name: 'get_topological_order',
    description: 'Returns files in dependency order (dependencies before dependents). Use this to determine the safe order to modify files during a refactor — process files in this order to avoid breaking intermediate builds. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subset of files to order (relative paths). If omitted, orders the entire project graph.',
        },
      },
    },
  },
  {
    name: 'simulate_move',
    description: 'Simulate moving a file from one path to another. Returns which files need import updates and what the new import strings should be. Use this before any file rename or refactor to get a complete migration plan. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Current relative path of the file (from project root, e.g., "src/utils/helpers.ts")',
        },
        to: {
          type: 'string',
          description: 'Target relative path after move (e.g., "src/shared/utils/helpers.ts")',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_most_coupled',
    description: 'Returns the most highly coupled files (highest combined in-degree + out-degree). High coupling signals refactoring candidates. Files with many consumers (high in-degree) are risky to change; files with many imports (high out-degree) have broad dependencies. Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        top: {
          type: 'number',
          description: 'Number of files to return (default: 10, max: 100)',
        },
      },
    },
  },
  {
    name: 'project_health',
    description: 'Aggregated project health check. Runs cycle detection (Tarjan), dead code analysis, coupling hotspots, graph complexity stats, max import depth, and index freshness — returns a global score A–F. Use as a quick diagnostic before any major refactoring. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'usage_breakdown',
    description: 'Show where Claude Code tokens go: task category breakdown (coding, debugging, feature, refactoring, testing, exploration, planning, delegation, git, build_deploy, conversation, brainstorming), MCP server call counts, and core tool usage. Inspired by Codeburn. No API key required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7d', '30d', 'all'],
          description: 'Time period (default: all)',
        },
      },
    },
  },
  {
    name: 'graph_export',
    description: 'Export a static architecture diagram from the dependency graph. Groups files by semantic layer (Tools, Storage, Graph, Indexer, Analytics, API, Frontend, Backend, Security, Config) based on directory-name heuristics. Three output formats: mermaid (copy-paste in README, renders on GitHub/GitLab), svg (standalone dark-theme file), html (self-contained page with legend + download button). Requires a prior reindex. No API call needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        format: {
          type: 'string',
          enum: ['mermaid', 'svg', 'html'],
          description: 'Output format: mermaid (default, copy into README), svg (standalone vector file), html (interactive dark-theme page)',
        },
        output_path: {
          type: 'string',
          description: 'Absolute or relative path for the output file. Default: .vectors/graph-export.{md|svg|html}',
        },
        focus_dir: {
          type: 'string',
          description: 'Only include files whose path contains this string (e.g., "src/graph"). Useful to zoom in on a sub-system.',
        },
        top_coupled: {
          type: 'number',
          description: 'Limit diagram to the N most coupled files (sorted by in-degree + out-degree). Useful to reduce noise on large projects.',
        },
        exclude_isolated: {
          type: 'boolean',
          description: 'Exclude files with no dependencies (in-degree = 0 and out-degree = 0). Default: true.',
        },
      },
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// List prompts handler
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

// Get prompt handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: promptArgs } = request.params;
  const args = (promptArgs ?? {}) as Record<string, string>;
  return {
    description: PROMPTS.find(p => p.name === name)?.description ?? name,
    messages: getPromptMessages(name, args),
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_code':
        return await handleSearchCode(args ?? {});
      case 'search_docs':
        return await handleSearchDocs(args ?? {});
      case 'reindex':
        return await handleReindex(args ?? {});
      case 'reindex_file':
        return await handleReindexFile(args ?? {});
      case 'get_file_tree':
        return await handleGetFileTree(args ?? {});
      case 'get_file_outline':
        return await handleGetFileOutline(args ?? {});
      case 'get_symbol':
        return await handleGetSymbol(args ?? {});
      case 'get_dependencies':
        return await handleGetDependencies(args ?? {});
      case 'get_dependents':
        return await handleGetDependents(args ?? {});
      case 'get_blast_radius':
        return await handleGetBlastRadius(args ?? {});
      case 'usage_stats':
        return await handleUsageStats(args ?? {});
      case 'usage_dashboard':
        return await handleUsageDashboard(args ?? {});
      case 'usage_anomalies':
        return await handleUsageAnomalies(args ?? {});
      case 'db_snapshot':
        return await handleDbSnapshot(args ?? {});
      case 'db_schema':
        return await handleDbSchema(args ?? {});
      case 'db_search':
        return await handleDbSearch(args ?? {});
      case 'graph_view':
        return await handleGraphView(args ?? {});
      case 'get_circular_deps':
        return await handleGetCircularDeps(args ?? {});
      case 'get_dead_code':
        return await handleGetDeadCode(args ?? {});
      case 'get_topological_order':
        return await handleGetTopologicalOrder(args ?? {});
      case 'simulate_move':
        return await handleSimulateMove(args ?? {});
      case 'get_most_coupled':
        return await handleGetMostCoupled(args ?? {});
      case 'project_health':
        return await handleProjectHealth(args ?? {});
      case 'usage_breakdown':
        return await handleUsageBreakdown(args ?? {});
      case 'graph_export':
        return await handleGraphExport(args ?? {});
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    console.error(`[Stellaris] Tool error (${name}):`, error);
    throw new McpError(ErrorCode.InternalError, `Tool failed: ${error.message}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Stellaris] Stellaris MCP server running on stdio');

  // Auto-index in background (don't block server startup)
  autoIndex().catch((err) => {
    console.error('[Stellaris] Background auto-index error:', err.message);
  });

  // Auto-scan usage data in background (no API key needed)
  autoScanUsage().catch(() => {});

  // Auto-snapshot DB schema in background if configured
  autoDbSnapshot().catch((err) => {
    console.error('[Stellaris DB] Background auto-snapshot error:', err.message);
  });
}

main().catch((error) => {
  console.error('[Stellaris] Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown: stop watchers and close all DB connections
function shutdown() {
  stopWatcher();       // stop fs.watch on ~/.claude/projects
  closeGraphStore();   // flush graph SQLite WAL
  closeLanceStore();   // release LanceDB connection handle
  stopGraphServer();   // close graph view HTTP server
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
