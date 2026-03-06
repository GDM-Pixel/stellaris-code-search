#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { handleSearchCode } from './tools/searchCode.js';
import { handleSearchDocs } from './tools/searchDocs.js';
import { handleReindex } from './tools/reindex.js';
import { handleGetFileTree } from './tools/getFileTree.js';
import { handleGetFileOutline } from './tools/getFileOutline.js';
import { handleGetSymbol } from './tools/getSymbol.js';
import { autoIndex } from './startup.js';

// Warn if OPENAI_API_KEY is missing (semantic search won't work, but AST tools will)
if (!process.env.OPENAI_API_KEY) {
  console.error('[Stellaris] Warning: OPENAI_API_KEY not set. search_code, search_docs, and reindex will not work. AST tools (get_file_tree, get_file_outline, get_symbol) are still available.');
}

const server = new Server(
  {
    name: 'stellaris-mcp',
    version: '2.3.0',
  },
  {
    capabilities: {
      tools: {},
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
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

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
      case 'get_file_tree':
        return await handleGetFileTree(args ?? {});
      case 'get_file_outline':
        return await handleGetFileOutline(args ?? {});
      case 'get_symbol':
        return await handleGetSymbol(args ?? {});
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
}

main().catch((error) => {
  console.error('[Stellaris] Fatal error:', error);
  process.exit(1);
});
