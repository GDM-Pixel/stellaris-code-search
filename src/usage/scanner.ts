/**
 * Claude Code Usage Tracking — JSONL Scanner + FileWatcher
 * Parses ~/.claude/projects/**\/*.jsonl and stores usage data in SQLite.
 * Incremental: only processes new/modified files.
 */

import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import fg from 'fast-glob';
import { upsertSession, insertTurn, getProcessedFile, upsertProcessedFile } from './store.js';

export interface ScanResult {
  filesProcessed: number;
  turnsAdded: number;
  sessionsUpdated: number;
}

/** Derive a human-readable project name from a cwd path. */
function projectNameFromCwd(cwd: string): string {
  if (!cwd) return 'unknown';
  // Normalize to forward slashes
  const normalized = cwd.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return 'unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** Extract tool name from assistant message content array. */
function extractToolName(content: unknown[]): string {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'tool_use') {
      return String((block as Record<string, unknown>).name ?? '');
    }
  }
  return '';
}

/** Parse a single JSONL file and insert new turns/sessions. Returns number of turns added. */
async function parseJSONLFile(
  filePath: string,
  startLine: number,
): Promise<{ turnsAdded: number; sessionsUpdated: Set<string>; totalLines: number }> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const turnsAdded = { count: 0 };
  const sessionsUpdated = new Set<string>();

  const newLines = lines.slice(startLine);

  for (const line of newLines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type !== 'assistant') continue;

    const msg = record.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    // stop_reason distinguishes real turns from streaming intermediates:
    //   null/empty  = content-block fragment (streaming artifact) — skip entirely
    //   "tool_use"  = Claude called a tool — store for token tracking, not a visible turn
    //   "end_turn"  = Claude's final visible response — store + count as turn
    //   "stop_sequence" = same as end_turn
    const stopReason = String(msg.stop_reason ?? '');
    if (!stopReason || stopReason === 'null') continue;

    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);

    const total = input + output + cacheRead + cacheCreation;
    if (total === 0) continue;

    const sessionId = String(record.sessionId ?? record.session_id ?? '');
    if (!sessionId) continue;

    const model = String(msg.model ?? '');
    const timestamp = String(record.timestamp ?? new Date().toISOString());
    const cwd = String(record.cwd ?? '');
    const gitBranch = String(record.gitBranch ?? '');
    const toolName = extractToolName((msg.content as unknown[]) ?? []);

    // Only end_turn/stop_sequence count as user-visible turns
    const isVisibleTurn = stopReason === 'end_turn' || stopReason === 'stop_sequence';

    // Insert individual turn (all stop_reasons stored for token tracking)
    await insertTurn({
      session_id: sessionId,
      timestamp,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      tool_name: toolName,
      cwd,
      stop_reason: stopReason,
    });

    // Upsert session (additive — turn_count only incremented for visible turns)
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

  let files: string[];
  try {
    files = await fg('**/*.jsonl', {
      cwd: projectsDir,
      absolute: true,
      onlyFiles: true,
    });
  } catch {
    // Projects directory doesn't exist yet — no sessions
    return result;
  }

  for (const filePath of files) {
    try {
      const fileStat = await stat(filePath);
      const mtime = fileStat.mtimeMs;

      const processed = await getProcessedFile(filePath);
      if (processed && Math.abs(processed.mtime - mtime) < 10) {
        // File unchanged — skip
        continue;
      }

      const startLine = processed ? processed.lines : 0;
      const { turnsAdded, sessionsUpdated, totalLines } = await parseJSONLFile(filePath, startLine);

      await upsertProcessedFile(filePath, mtime, totalLines);

      if (turnsAdded > 0) {
        result.filesProcessed++;
        result.turnsAdded += turnsAdded;
        for (const s of sessionsUpdated) allSessions.add(s);
      } else if (!processed) {
        // New file but no turns (e.g., only user messages) — still mark as processed
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
 *
 * Uses a 2s debounce (vs 500ms) to avoid thrashing on large project trees
 * (1500+ JSONL files). The recursive watcher fires many events in rapid
 * succession during active Claude sessions — we coalesce them into a single
 * scanUsage() call per burst.
 */
export function startWatcher(): void {
  if (watcher) return; // Already watching

  const projectsDir = join(homedir(), '.claude', 'projects');

  try {
    watcher = watch(projectsDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;

      // Debounce: coalesce rapid bursts into a single scan
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanUsage().catch(() => {}); // Silent background scan
      }, 2000);
    });

    watcher.on('error', () => {
      // Silently ignore watcher errors (e.g., directory deleted)
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
