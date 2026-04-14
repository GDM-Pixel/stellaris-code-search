/**
 * Claude Code Usage — Turn classifier
 *
 * Classifies each user→assistant exchange into one of 13 task categories,
 * using the same heuristic approach as Codeburn (AgentSeal/codeburn) but
 * adapted for bilingual FR+EN usage and stricter tool-first classification.
 *
 * Classification order (first match wins):
 *  1. Agent spawn → delegation
 *  2. Plan mode / TodoWrite → planning
 *  3. Edit/Write/NotebookEdit present → coding (refined via keywords to debugging/refactoring/feature)
 *  4. Read/Grep/Glob only (no Edit/Write) → exploration
 *  5. Bash → refined via keywords to git / build_deploy / testing
 *  6. MCP tools only (no core edit/bash tools) → exploration
 *  7. No tools + brainstorming keywords → brainstorming
 *  8. No tools → conversation
 *  9. Fallback → general
 */

export type TaskCategory =
  | 'coding'
  | 'debugging'
  | 'feature'
  | 'refactoring'
  | 'testing'
  | 'exploration'
  | 'planning'
  | 'delegation'
  | 'git'
  | 'build_deploy'
  | 'conversation'
  | 'brainstorming'
  | 'general';

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  coding:       'Coding',
  debugging:    'Debugging',
  feature:      'Feature Dev',
  refactoring:  'Refactoring',
  testing:      'Testing',
  exploration:  'Exploration',
  planning:     'Planning',
  delegation:   'Delegation',
  git:          'Git Ops',
  build_deploy: 'Build/Deploy',
  conversation: 'Conversation',
  brainstorming:'Brainstorming',
  general:      'General',
};

/** Emoji badge for each category — used in markdown tables and legend. */
export const CATEGORY_ICONS: Record<TaskCategory, string> = {
  coding:       '💻',
  debugging:    '🐛',
  feature:      '✨',
  refactoring:  '♻️',
  testing:      '🧪',
  exploration:  '🔍',
  planning:     '📋',
  delegation:   '🤖',
  git:          '🌿',
  build_deploy: '🚀',
  conversation: '💬',
  brainstorming:'🧠',
  general:      '📌',
};

/** Hex colors for dashboard donut/stacked charts. */
export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  coding:       '#3b82f6',  // blue
  debugging:    '#ef4444',  // red
  feature:      '#22c55e',  // green
  refactoring:  '#f97316',  // orange
  testing:      '#8b5cf6',  // violet
  exploration:  '#06b6d4',  // cyan
  planning:     '#eab308',  // yellow
  delegation:   '#ec4899',  // pink
  git:          '#6b7280',  // gray
  build_deploy: '#f59e0b',  // amber
  conversation: '#94a3b8',  // slate
  brainstorming:'#a78bfa',  // purple
  general:      '#64748b',  // gray-600
};

// ─── Keyword patterns (FR + EN) ───────────────────────────────────────────────

const RE_DEBUGGING = /fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|not\s+working|wrong|unexpected|corrige|correction|plante|cassé|ne\s+marche\s+pas|erreur|problème|bogue/i;
const RE_FEATURE = /add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate|ajoute|crée|créer|implémenter|nouvelle|nouveau|ajouter|construire|mettre\s+en\s+place/i;
const RE_REFACTOR = /refactor|clean\s*up|rename|reorganize|simplify|extract|restructure|move|migrate|split|refacto|renomme|nettoie|réorganise|simplifie|déplace|migrer|séparer/i;
const RE_TESTING = /test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|npx\s+vitest|npx\s+jest|tester|vérifier|vérif/i;
const RE_GIT = /git\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)|faire\s+un\s+commit|pousser|merger/i;
const RE_BUILD_DEPLOY = /npm\s+run\s+build|npm\s+publish|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|pm2|systemctl|cargo\s+build|pip\s+install|déployer|deployer|builder|construire|publish/i;
const RE_BRAINSTORM = /brainstorm|idea|what\s+if|explore|think\s+about|approach|strategy|design|consider|how\s+should|what\s+would|opinion|suggest|recommend|idée|penser|approche|stratégie|réfléchir|proposer|recommander|discuter/i;

// ─── Tool name sets ────────────────────────────────────────────────────────────

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'FileEditTool', 'FileWriteTool']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'FileReadTool', 'GrepTool', 'GlobTool', 'LS']);
const BASH_TOOLS = new Set(['Bash', 'BashTool', 'PowerShellTool']);
const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop']);

// ─── Classifier ───────────────────────────────────────────────────────────────

export interface ClassifyInput {
  user_message: string;
  core_tools: string[];
  mcp_tools: Array<{ server: string; tool: string }>;
  has_agent_spawn: boolean;
  has_plan_mode: boolean;
}

export function classifyTurn(input: ClassifyInput): TaskCategory {
  const { user_message, core_tools, has_agent_spawn, has_plan_mode } = input;
  const toolSet = new Set(core_tools);

  // 1. Agent spawn → delegation (highest priority — always intentional)
  if (has_agent_spawn || toolSet.has('Agent')) return 'delegation';

  // 2. Plan mode or planning tools → planning
  if (has_plan_mode || core_tools.some(t => PLAN_TOOLS.has(t))) return 'planning';

  const hasEdit = core_tools.some(t => EDIT_TOOLS.has(t));
  const hasRead = core_tools.some(t => READ_TOOLS.has(t));
  const hasBash = core_tools.some(t => BASH_TOOLS.has(t));

  // 3. Edit/Write present → code modification, refine via keywords
  if (hasEdit) {
    if (RE_DEBUGGING.test(user_message)) return 'debugging';
    if (RE_REFACTOR.test(user_message)) return 'refactoring';
    if (RE_FEATURE.test(user_message)) return 'feature';
    return 'coding';
  }

  // 4. Read/Grep/Glob only (no Edit/Write/Bash) → exploration
  if (hasRead && !hasBash) return 'exploration';

  // 5. Bash → refine via keywords or user message
  if (hasBash) {
    if (RE_TESTING.test(user_message)) return 'testing';
    if (RE_GIT.test(user_message)) return 'git';
    if (RE_BUILD_DEPLOY.test(user_message)) return 'build_deploy';
    // Fallback for Bash without clear signals: check git/build/test via raw content
    if (/\bgit\b/i.test(user_message)) return 'git';
    if (/\bbuild\b|\bdeploy\b|\bdocker\b/i.test(user_message)) return 'build_deploy';
    if (/\btest\b|\bspec\b/i.test(user_message)) return 'testing';
    return 'build_deploy'; // Bash without context → assume build/infra
  }

  // 6. MCP tools only (no core edit/bash) → exploration (research / lookup)
  if (input.mcp_tools.length > 0) return 'exploration';

  // 7. No tools — classify by intent keywords
  if (RE_BRAINSTORM.test(user_message)) return 'brainstorming';
  if (user_message.trim().length > 0) return 'conversation';

  return 'general';
}
