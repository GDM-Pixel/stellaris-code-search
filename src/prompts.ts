/**
 * Stellaris MCP Prompts
 * Pre-built guided workflows that help Claude know when and how to use Stellaris tools.
 */

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
}

export const PROMPTS: PromptDefinition[] = [
  {
    name: 'nova_explore',
    description: 'Guided workflow to understand a codebase from scratch. Starts with structure overview, then semantic search, then deep-dives into specific files and symbols.',
    arguments: [
      {
        name: 'focus',
        description: 'Optional: specific area or feature to focus on (e.g., "authentication", "API layer")',
        required: false,
      },
    ],
  },
  {
    name: 'nova_find',
    description: 'Find how a specific feature or concept is implemented. Uses semantic search to locate relevant files, then drills down to exact functions.',
    arguments: [
      {
        name: 'feature',
        description: 'The feature or concept to find (e.g., "user authentication", "payment processing", "error handling")',
        required: true,
      },
    ],
  },
  {
    name: 'nova_file',
    description: 'Deep-dive into a specific file: get its full symbol outline, then read the key functions with context.',
    arguments: [
      {
        name: 'file',
        description: 'Relative path to the file (e.g., "src/tools/searchCode.ts")',
        required: true,
      },
    ],
  },
  {
    name: 'nova_review',
    description: 'Review recently modified files and understand their impact. Lists changed files, explores their structure, and identifies what other code may be affected.',
    arguments: [],
  },
  {
    name: 'nova_usage',
    description: 'Show Claude Code token usage statistics and estimated costs. Optionally opens the full dashboard in VS Code.',
    arguments: [
      {
        name: 'period',
        description: 'Time period: today, 7d, 30d, all (default: today)',
        required: false,
      },
      {
        name: 'group_by',
        description: 'Group by: model, project, day (default: model)',
        required: false,
      },
    ],
  },
];

/**
 * Returns the prompt message content for a given prompt name and args.
 */
export function getPromptMessages(name: string, args: Record<string, string> = {}): { role: string; content: { type: string; text: string } }[] {
  switch (name) {
    case 'nova_explore': {
      const focus = args.focus ? ` with a focus on "${args.focus}"` : '';
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please explore this codebase${focus} using the Stellaris MCP tools in this order:

1. **get_file_tree** — Get a structural overview of the project (file organization, languages, counts)
2. **search_code** — Search for the main entry points and core modules${args.focus ? ` related to "${args.focus}"` : ''}
3. **get_file_outline** — For the most relevant files found, get their symbol outlines
4. **get_symbol** — Read the implementation of the key functions/classes

Build a clear understanding of:
- How the project is organized
- What the main modules do
- How data flows through the system${args.focus ? `\n- Specifically how "${args.focus}" works` : ''}

Start with get_file_tree now.`,
        },
      }];
    }

    case 'nova_find': {
      const feature = args.feature ?? 'the requested feature';
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Find the implementation of "${feature}" using the Stellaris MCP tools:

1. **search_code** — Search for "${feature}" with a natural language query to find relevant files and functions
2. **get_file_outline** — For each promising file, get the symbol outline to understand its structure
3. **get_symbol** — Read the full source of the most relevant symbols with context

For each result found, explain:
- Which file implements it and why
- The key functions/classes involved
- How they interact with each other

Start by searching for "${feature}" now.`,
        },
      }];
    }

    case 'nova_file': {
      const file = args.file ?? 'the specified file';
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please do a thorough analysis of the file "${file}" using Stellaris:

1. **get_file_outline** — Get the complete symbol list, imports, exports, and any warnings for "${file}"
2. **get_symbol** — For each significant symbol in the outline, read its full source with context

After reading, provide:
- A summary of what this file does
- Its main responsibilities and dependencies (from imports)
- The purpose of each key function/class
- Any notable patterns, warnings, or TODOs

Start with get_file_outline("${file}") now.`,
        },
      }];
    }

    case 'nova_review': {
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Review the recently modified files in this project using Stellaris MCP tools:

1. First, use get_file_tree to see the overall project structure and identify which areas may have changed
2. For files you know were recently modified (from git status or user context), use get_file_outline to understand their current structure
3. Use search_code to find other code that imports or uses the changed symbols — this reveals what might be affected
4. Use get_symbol to read the specific changed functions with full context

For each changed file, analyze:
- What the changes likely affect
- Which other files/symbols depend on it
- Whether the changes seem consistent with the rest of the codebase

Start with get_file_tree to orient yourself.`,
        },
      }];
    }

    case 'nova_usage': {
      const period = args.period ?? 'today';
      const groupBy = args.group_by ?? 'model';
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please show my Claude Code token usage statistics using the Stellaris MCP tools:

1. **usage_stats** — Call with period: "${period}" and group_by: "${groupBy}" to get usage statistics
2. Present the results clearly: tokens consumed, estimated cost, breakdown by ${groupBy}
3. After showing the stats, offer to open the full dashboard with **usage_dashboard** (opens in VS Code Simple Browser)

Start by calling usage_stats now.`,
        },
      }];
    }

    default:
      return [{
        role: 'user',
        content: {
          type: 'text',
          text: `Unknown prompt: ${name}. Available prompts: nova_explore, nova_find, nova_file, nova_review, nova_usage`,
        },
      }];
  }
}
