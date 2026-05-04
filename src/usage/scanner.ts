/**
 * Claude Code Usage Tracking — JSONL Scanner + FileWatcher
 * Parses ~/.claude/projects/**\/*.jsonl and stores usage data in SQLite.
 * Incremental: only processes new/modified files.
 *
 * v3.9.0 additions:
 * - Global dedup by message.id (Set<string> across all files) — prevents double-counting
 *   on /resume sessions where the same messages re-appear in a new JSONL file.
 * - Capture user_message_preview (last user text before each assistant turn) for classifier.
 * - Split core_tools vs mcp_tools (prefix `mcp__`).
 * - Capture web_search_requests (usage.server_tool_use.web_search_requests).
 * - Capture speed field (usage.speed = 'standard' | 'fast').
 * - Derive has_agent_spawn + has_plan_mode booleans from tool names.
 * - Capture user_parent_ts (timestamp of the user message that triggered the turn).
 * - Category classification via classifier.ts (called after extracting the above).
 */

import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import fg from 'fast-glob';
import {
  upsertSession,
  insertTurn,
  getProcessedFile,
  upsertProcessedFile,
  incrementSessionErrors,
} from './store.js';
import { classifyTurn } from './classifier.js';

export interface ScanResult {
  filesProcessed: number;
  turnsAdded: number;
  sessionsUpdated: number;
}

/** Derive a human-readable project name from a cwd path. */
function projectNameFromCwd(cwd: string): string {
  if (!cwd) return 'unknown';
  const normalized = cwd.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return 'unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** Extract first tool name from assistant message content array. */
function extractToolName(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_use') {
      return String((block as Record<string, unknown>).name ?? '');
    }
  }
  return '';
}

/** Extract all tool_use names from an assistant message content array. */
function extractAllToolNames(content: unknown[]): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_use') {
      const name = String((block as Record<string, unknown>).name ?? '');
      if (name) names.push(name);
    }
  }
  return names;
}

/** Split tool names into core tools (no mcp__ prefix) and MCP tools. */
function splitTools(allTools: string[]): {
  coreTools: string[];
  mcpTools: Array<{ server: string; tool: string }>;
} {
  const coreTools: string[] = [];
  const mcpTools: Array<{ server: string; tool: string }> = [];
  for (const name of allTools) {
    if (name.startsWith('mcp__')) {
      // Format: mcp__<server>__<tool_name>
      const parts = name.split('__');
      const server = parts[1] ?? name;
      const tool = parts.slice(2).join('__') || name;
      mcpTools.push({ server, tool });
    } else {
      coreTools.push(name);
    }
  }
  return { coreTools, mcpTools };
}

/** Extract plain text from a user message's content (string or block array). */
function extractUserText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content.substring(0, 300);
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') {
        texts.push(b.text);
      }
    }
    return texts.join(' ').substring(0, 300);
  }
  return '';
}

/**
 * Count tool_result blocks with is_error:true inside a user-type record.
 * These correspond to tool calls that failed (shell errors, file not found, etc.)
 */
function countToolErrors(record: Record<string, unknown>): number {
  if (record.type !== 'user') return 0;
  const msg = record.message as Record<string, unknown> | undefined;
  if (!msg) return 0;
  const content = msg.content as unknown[] | undefined;
  if (!Array.isArray(content)) return 0;
  let errors = 0;
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_result' && (b.is_error === true || b.is_error === 'true')) {
      errors++;
    }
  }
  return errors;
}

/**
 * Parse a single JSONL file and insert new turns/sessions.
 *
 * @param seenMessageIds - Global dedup Set shared across ALL files in a scan pass.
 *   Any assistant message with a message.id already in this set is skipped entirely.
 *   This prevents double-counting when /resume creates a new JSONL that begins with
 *   a copy of the previous session's messages.
 */
async function parseJSONLFile(
  filePath: string,
  startLine: number,
  seenMessageIds: Set<string>,
): Promise<{ turnsAdded: number; sessionsUpdated: Set<string>; totalLines: number }> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const turnsAdded = { count: 0 };
  const sessionsUpdated = new Set<string>();
  const sessionErrorCounts = new Map<string, number>();

  const newLines = lines.slice(startLine);

  // Track last user message seen (for classification)
  let lastUserText = '';
  let lastUserTs = '';

  for (const line of newLines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // ── User records: track text for classifier + count tool errors ───────────
    if (record.type === 'user') {
      const msg = record.message as Record<string, unknown> | undefined;
      if (msg) {
        const text = extractUserText(msg);
        if (text) {
          lastUserText = text;
          lastUserTs = String(record.timestamp ?? '');
        }
      }
      const errors = countToolErrors(record);
      if (errors > 0) {
        const sessionId = String(record.sessionId ?? record.session_id ?? '');
        if (sessionId) {
          sessionErrorCounts.set(sessionId, (sessionErrorCounts.get(sessionId) ?? 0) + errors);
        }
      }
      continue;
    }

    if (record.type !== 'assistant') continue;

    const msg = record.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    // ── Global dedup by message.id ────────────────────────────────────────────
    const messageId = typeof msg.id === 'string' ? msg.id : null;
    if (messageId) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
    }

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    const stopReason = String(msg.stop_reason ?? '');
    if (!stopReason || stopReason === 'null') continue;

    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);

    const cacheCreationUsage = usage.cache_creation as Record<string, unknown> | undefined;
    const cacheCreation5m = Number(cacheCreationUsage?.ephemeral_5m_input_tokens ?? 0);
    const cacheCreation1h = Number(cacheCreationUsage?.ephemeral_1h_input_tokens ?? 0);

    // web_search_requests (Anthropic server tool, charged separately)
    const serverToolUse = usage.server_tool_use as Record<string, unknown> | undefined;
    const webSearchRequests = Number(serverToolUse?.web_search_requests ?? 0);

    // speed tier ('standard' | 'fast') — affects pricing in some plans
    const speed = String(usage.speed ?? 'standard');

    const total = input + output + cacheRead + cacheCreation;
    if (total === 0) continue;

    const sessionId = String(record.sessionId ?? record.session_id ?? '');
    if (!sessionId) continue;

    const model = String(msg.model ?? '');
    const timestamp = String(record.timestamp ?? new Date().toISOString());
    const cwd = String(record.cwd ?? '');
    const gitBranch = String(record.gitBranch ?? '');

    // Tool analysis
    const allToolNames = extractAllToolNames((msg.content as unknown[]) ?? []);
    const toolName = allToolNames[0] ?? '';
    const allToolsJson = allToolNames.length > 0 ? JSON.stringify(allToolNames) : '';

    const { coreTools, mcpTools } = splitTools(allToolNames);
    const hasAgentSpawn = allToolNames.includes('Agent');
    const hasPlanMode = allToolNames.includes('EnterPlanMode');

    // Classify this turn
    const category = classifyTurn({
      user_message: lastUserText,
      core_tools: coreTools,
      mcp_tools: mcpTools,
      has_agent_spawn: hasAgentSpawn,
      has_plan_mode: hasPlanMode,
    });

    const coreToolsJson = coreTools.length > 0 ? JSON.stringify(coreTools) : '';
    const mcpToolsJson = mcpTools.length > 0 ? JSON.stringify(mcpTools) : '';

    const isVisibleTurn = stopReason === 'end_turn' || stopReason === 'stop_sequence';

    await insertTurn({
      session_id: sessionId,
      timestamp,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      cache_creation_5m: cacheCreation5m,
      cache_creation_1h: cacheCreation1h,
      tool_name: toolName,
      all_tools: allToolsJson,
      cwd,
      stop_reason: stopReason,
      message_id: messageId ?? '',
      user_message_preview: isVisibleTurn ? lastUserText : '',
      core_tools: coreToolsJson,
      mcp_tools: mcpToolsJson,
      web_search_requests: webSearchRequests,
      speed,
      category,
      user_parent_ts: isVisibleTurn ? lastUserTs : '',
    });

    await upsertSession({
      session_id: sessionId,
      project_name: projectNameFromCwd(cwd),
      first_timestamp: timestamp,
      last_timestamp: timestamp,
      git_branch: gitBranch,
      total_input_tokens: input,
      total_output_tokens: output,
      total_cache_read: cacheRead,
      total_cache_creation: cacheCreation,
      model,
      turn_count: isVisibleTurn ? 1 : 0,
    });

    if (isVisibleTurn) turnsAdded.count++;
    sessionsUpdated.add(sessionId);
  }

  for (const [sessionId, count] of sessionErrorCounts) {
    await incrementSessionErrors(sessionId, count);
  }

  return {
    turnsAdded: turnsAdded.count,
    sessionsUpdated,
    totalLines: lines.length,
  };
}

/** Full incremental scan of all Claude Code JSONL files. */
export async function scanUsage(): Promise<ScanResult> {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const result: ScanResult = { filesProcessed: 0, turnsAdded: 0, sessionsUpdated: 0 };
  const allSessions = new Set<string>();

  // Global dedup Set — shared across all files in this scan pass.
  // Prevents double-counting messages that appear in multiple JSONL files
  // (happens when /resume creates a new JSONL that copies prior messages).
  const seenMessageIds = new Set<string>();

  let files: string[];
  try {
    files = await fg('**/*.jsonl', {
      cwd: projectsDir,
      absolute: true,
      onlyFiles: true,
    });
  } catch {
    return result;
  }

  for (const filePath of files) {
    try {
      const fileStat = await stat(filePath);
      const mtime = fileStat.mtimeMs;

      const processed = await getProcessedFile(filePath);
      if (processed && Math.abs(processed.mtime - mtime) < 10) {
        continue;
      }

      const startLine = processed ? processed.lines : 0;
      const { turnsAdded, sessionsUpdated, totalLines } = await parseJSONLFile(
        filePath,
        startLine,
        seenMessageIds,
      );

      await upsertProcessedFile(filePath, mtime, totalLines);

      if (turnsAdded > 0) {
        result.filesProcessed++;
        result.turnsAdded += turnsAdded;
        for (const s of sessionsUpdated) allSessions.add(s);
      } else if (!processed) {
        await upsertProcessedFile(filePath, mtime, totalLines);
      }
    } catch {
      // Skip unreadable files silently
    }
  }

  result.sessionsUpdated = allSessions.size;
  return result;
}

let watcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start watching ~/.claude/projects/ for new/modified JSONL files.
 * Uses a 2s debounce to avoid thrashing on large project trees.
 */
export function startWatcher(): void {
  if (watcher) return;

  const projectsDir = join(homedir(), '.claude', 'projects');

  try {
    watcher = watch(projectsDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanUsage().catch(() => {});
      }, 2000);
    });

    watcher.on('error', () => {
      watcher = null;
    });
  } catch {
    // Directory doesn't exist yet — watcher not started
  }
}

/** Stop the file watcher. */
export function stopWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
