/**
 * Claude Code Usage Tracking — SQLite store
 * Database lives at ~/.claude/usage.db (global, not per-project)
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { calculateFullApiCost, calculateUsefulCost } from './pricing.js';

export interface SessionRow {
  session_id: string;
  project_name: string;
  first_timestamp: string;
  last_timestamp: string;
  git_branch: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_creation: number;
  model: string;
  turn_count: number;
  error_count?: number;  // cumulative count of tool_result is_error:true in this session
}

export interface TurnRow {
  session_id: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cache_creation_5m: number;    // ephemeral 5-min cache tier (0 if not present)
  cache_creation_1h: number;    // ephemeral 1-hour cache tier (0 if not present)
  tool_name: string;            // first tool_use name (backwards compat)
  all_tools: string;            // JSON array of all tool_use names in this turn ('' if ≤1)
  cwd: string;
  stop_reason: string;
  // v3.9.0 additions
  message_id?: string;          // Anthropic message.id — for global dedup across JSONL files
  user_message_preview?: string;// First 300 chars of the user message that triggered this turn
  core_tools?: string;          // JSON array of non-MCP tool names
  mcp_tools?: string;           // JSON array of {server, tool} objects for mcp__* tools
  web_search_requests?: number; // usage.server_tool_use.web_search_requests
  speed?: string;               // 'standard' | 'fast'
  category?: string;            // TaskCategory from classifier.ts
  user_parent_ts?: string;      // Timestamp of the parent user message
}

export interface ProcessedFileRow {
  path: string;
  mtime: number;
  lines: number;
}

export interface DailyModelRow {
  day: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  turns: number;
}

export interface SessionDashRow {
  session_id: string;
  project: string;
  last: string;
  last_date: string;
  duration_min: number;
  model: string;
  turns: number;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  cost_full: number;    // precomputed server-side
  cost_useful: number;  // precomputed server-side
}

export interface ModelCostRow {
  model: string;
  turns: number;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  cost_full: number;
  cost_useful: number;
}

export interface CategoryBreakdownRow {
  category: string;
  turn_count: number;
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_creation: number;
}

export interface McpBreakdownRow {
  server: string;
  call_count: number;
  turn_count: number;
}

export interface CoreToolBreakdownRow {
  tool: string;
  call_count: number;
}

export interface DashboardData {
  all_models: string[];
  daily_by_model: DailyModelRow[];
  sessions_all: SessionDashRow[];
  model_costs: ModelCostRow[];
  cache_stats: CacheStatsRow[];
  anomalies: AnomalyRow[];
  category_breakdown: CategoryBreakdownRow[];
  mcp_breakdown: McpBreakdownRow[];
  core_tool_breakdown: CoreToolBreakdownRow[];
  max_price_monthly: number;  // sent from server to avoid JS hardcode
  generated_at: string;
}

let db: Database.Database | null = null;

export async function getDb(): Promise<Database.Database> {
  if (db) return db;

  await mkdir(join(homedir(), '.claude'), { recursive: true });

  db = new Database(join(homedir(), '.claude', 'usage.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_name TEXT DEFAULT '',
      first_timestamp TEXT DEFAULT '',
      last_timestamp TEXT DEFAULT '',
      git_branch TEXT DEFAULT '',
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read INTEGER DEFAULT 0,
      total_cache_creation INTEGER DEFAULT 0,
      model TEXT DEFAULT '',
      turn_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT DEFAULT '',
      model TEXT DEFAULT '',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      tool_name TEXT DEFAULT '',
      cwd TEXT DEFAULT '',
      stop_reason TEXT DEFAULT '',
      UNIQUE(session_id, timestamp, model, stop_reason)
    );

    CREATE TABLE IF NOT EXISTS processed_files (
      path TEXT PRIMARY KEY,
      mtime REAL NOT NULL,
      lines INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_timestamp);
  `);

  // Migration: ensure UNIQUE index includes stop_reason (upgraded from v3.2 which lacked it)
  // If the old index exists without stop_reason, drop and recreate it.
  const oldIndex = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='turns' AND name='idx_turns_unique'")
    .get() as { sql: string } | undefined;

  const needsNewIndex = !oldIndex || !oldIndex.sql.includes('stop_reason');
  if (needsNewIndex) {
    db.exec(`
      DROP INDEX IF EXISTS idx_turns_unique;
      DELETE FROM turns WHERE id NOT IN (
        SELECT MIN(id) FROM turns GROUP BY session_id, timestamp, model, stop_reason
      );
      CREATE UNIQUE INDEX idx_turns_unique ON turns(session_id, timestamp, model, stop_reason);
    `);
    // Force full rescan: old index may have silently dropped tool_use entries
    db.exec(`DELETE FROM processed_files`);
  }

  // Migration: add stop_reason column if not present (added in v3.2.0)
  const hasStopReason = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='stop_reason'")
    .get() as { n: number };

  if (hasStopReason.n === 0) {
    db.exec(`ALTER TABLE turns ADD COLUMN stop_reason TEXT DEFAULT ''`);
  }

  // Migration: purge only streaming fragments (null/empty stop_reason).
  // Keep tool_use entries — they carry the real cache_read tokens that represent
  // the majority of API cost. Turn counting is done via CASE WHEN in queries.
  db.exec(`DELETE FROM turns WHERE stop_reason = '' OR stop_reason IS NULL OR stop_reason = 'null'`);

  // Migration: clear processed_files so tool_use entries are re-imported on next scan.
  // This is needed when upgrading from the old migration that deleted tool_use rows.
  const hasToolUse = db
    .prepare("SELECT COUNT(*) as n FROM turns WHERE stop_reason = 'tool_use'")
    .get() as { n: number };
  if (hasToolUse.n === 0) {
    db.exec(`DELETE FROM processed_files`);
  }

  // Migration v3.7: add error_count to sessions (ALTER TABLE with static SQL, no user input)
  const hasErrorCount = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('sessions') WHERE name='error_count'")
    .get() as { n: number };
  if (hasErrorCount.n === 0) {
    // Static DDL — no user input, no injection risk
    db.exec('ALTER TABLE sessions ADD COLUMN error_count INTEGER DEFAULT 0');
  }

  // Migration v3.7: add cache TTL-tier columns to turns
  const hasCacheCreation5m = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='cache_creation_5m'")
    .get() as { n: number };
  if (hasCacheCreation5m.n === 0) {
    db.exec('ALTER TABLE turns ADD COLUMN cache_creation_5m INTEGER DEFAULT 0');
    db.exec('ALTER TABLE turns ADD COLUMN cache_creation_1h INTEGER DEFAULT 0');
  }

  // Migration v3.7: add all_tools column (JSON array of all tool_use names per turn)
  const hasAllTools = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='all_tools'")
    .get() as { n: number };
  if (hasAllTools.n === 0) {
    db.exec("ALTER TABLE turns ADD COLUMN all_tools TEXT DEFAULT ''");
  }

  // Migration v3.9: add message_id column (global dedup by Anthropic message.id)
  const hasMessageId = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='message_id'")
    .get() as { n: number };
  if (hasMessageId.n === 0) {
    db.exec('ALTER TABLE turns ADD COLUMN message_id TEXT DEFAULT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_turns_message_id ON turns(message_id) WHERE message_id IS NOT NULL');
    // Force rescan so existing turns get their message_id populated
    db.exec('DELETE FROM processed_files');
  }

  // Migration v3.9: add user_message_preview
  const hasUserMsgPreview = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='user_message_preview'")
    .get() as { n: number };
  if (hasUserMsgPreview.n === 0) {
    db.exec("ALTER TABLE turns ADD COLUMN user_message_preview TEXT DEFAULT ''");
  }

  // Migration v3.9: add core_tools, mcp_tools, web_search_requests, speed, category, user_parent_ts
  const hasCategory = db
    .prepare("SELECT COUNT(*) as n FROM pragma_table_info('turns') WHERE name='category'")
    .get() as { n: number };
  if (hasCategory.n === 0) {
    db.exec("ALTER TABLE turns ADD COLUMN core_tools TEXT DEFAULT ''");
    db.exec("ALTER TABLE turns ADD COLUMN mcp_tools TEXT DEFAULT ''");
    db.exec("ALTER TABLE turns ADD COLUMN web_search_requests INTEGER DEFAULT 0");
    db.exec("ALTER TABLE turns ADD COLUMN speed TEXT DEFAULT 'standard'");
    db.exec("ALTER TABLE turns ADD COLUMN category TEXT DEFAULT 'general'");
    db.exec("ALTER TABLE turns ADD COLUMN user_parent_ts TEXT DEFAULT ''");
    db.exec('CREATE INDEX IF NOT EXISTS idx_turns_category ON turns(category)');
    // Full wipe so existing turns (with category=DEFAULT 'general') get re-inserted
    // with proper category/core_tools/mcp_tools values on next scan
    db.exec('DELETE FROM turns');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM processed_files');
  }

  // Retention: purge turns older than 180 days — dashboard only shows 90 days anyway.
  // processed_files entries are kept (they prevent re-scanning old JSONL files).
  db.exec("DELETE FROM turns WHERE timestamp < datetime('now', '-180 days')");
  db.exec("DELETE FROM sessions WHERE last_timestamp < datetime('now', '-180 days')");

  return db;
}

export async function upsertSession(
  data: Omit<SessionRow, 'turn_count'> & { turn_count?: number },
): Promise<void> {
  const conn = await getDb();
  conn
    .prepare(
      `INSERT INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, git_branch,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, model, turn_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         last_timestamp = MAX(last_timestamp, excluded.last_timestamp),
         total_input_tokens = total_input_tokens + excluded.total_input_tokens,
         total_output_tokens = total_output_tokens + excluded.total_output_tokens,
         total_cache_read = total_cache_read + excluded.total_cache_read,
         total_cache_creation = total_cache_creation + excluded.total_cache_creation,
         model = excluded.model,
         turn_count = turn_count + excluded.turn_count`,
    )
    .run(
      data.session_id,
      data.project_name,
      data.first_timestamp,
      data.last_timestamp,
      data.git_branch,
      data.total_input_tokens,
      data.total_output_tokens,
      data.total_cache_read,
      data.total_cache_creation,
      data.model,
      data.turn_count ?? 1,
    );
}

export async function insertTurn(data: TurnRow): Promise<void> {
  const conn = await getDb();
  conn
    .prepare(
      `INSERT OR IGNORE INTO turns
        (session_id, timestamp, model, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, cache_creation_5m, cache_creation_1h,
         tool_name, all_tools, cwd, stop_reason,
         message_id, user_message_preview, core_tools, mcp_tools,
         web_search_requests, speed, category, user_parent_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.session_id,
      data.timestamp,
      data.model,
      data.input_tokens,
      data.output_tokens,
      data.cache_read_tokens,
      data.cache_creation_tokens,
      data.cache_creation_5m ?? 0,
      data.cache_creation_1h ?? 0,
      data.tool_name,
      data.all_tools ?? '',
      data.cwd,
      data.stop_reason,
      data.message_id ?? null,
      data.user_message_preview ?? '',
      data.core_tools ?? '',
      data.mcp_tools ?? '',
      data.web_search_requests ?? 0,
      data.speed ?? 'standard',
      data.category ?? 'general',
      data.user_parent_ts ?? '',
    );
}

/** Increment error_count on a session by `count`. Called after each JSONL file scan. */
export async function incrementSessionErrors(sessionId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const conn = await getDb();
  conn
    .prepare(
      `INSERT INTO sessions (session_id, error_count)
       VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET error_count = error_count + excluded.error_count`,
    )
    .run(sessionId, count);
}

export async function getProcessedFile(filePath: string): Promise<ProcessedFileRow | null> {
  const conn = await getDb();
  const row = conn
    .prepare('SELECT path, mtime, lines FROM processed_files WHERE path = ?')
    .get(filePath) as ProcessedFileRow | undefined;
  return row ?? null;
}

export async function upsertProcessedFile(
  filePath: string,
  mtime: number,
  lines: number,
): Promise<void> {
  const conn = await getDb();
  conn
    .prepare(
      `INSERT INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, lines = excluded.lines`,
    )
    .run(filePath, mtime, lines);
}

export interface StatsQuery {
  period: 'today' | '7d' | '30d' | 'all';
  groupBy: 'model' | 'project' | 'day';
}

export interface StatsRow {
  group_key: string;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  turns: number;
  sessions: number;
}

function periodFilter(period: StatsQuery['period']): string {
  switch (period) {
    case 'today':
      return "date(timestamp) = date('now')";
    case '7d':
      return "timestamp >= datetime('now', '-7 days')";
    case '30d':
      return "timestamp >= datetime('now', '-30 days')";
    case 'all':
      return '1=1';
  }
}

export async function queryStats(query: StatsQuery): Promise<StatsRow[]> {
  const conn = await getDb();
  const filter = periodFilter(query.period);

  let groupExpr: string;
  switch (query.groupBy) {
    case 'model':
      groupExpr = 'model';
      break;
    case 'project':
      groupExpr = 'cwd';
      break;
    case 'day':
      groupExpr = 'date(timestamp)';
      break;
  }

  return conn
    .prepare(
      `SELECT
        ${groupExpr} AS group_key,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation,
        SUM(CASE WHEN stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turns,
        COUNT(DISTINCT session_id) AS sessions
       FROM turns
       WHERE ${filter}
       GROUP BY group_key
       ORDER BY input + output DESC`,
    )
    .all() as StatsRow[];
}

export async function queryTotals(period: StatsQuery['period']): Promise<{
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  turns: number;
  sessions: number;
}> {
  const conn = await getDb();
  const filter = periodFilter(period);

  const row = conn
    .prepare(
      `SELECT
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation,
        SUM(CASE WHEN stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turns,
        COUNT(DISTINCT session_id) AS sessions
       FROM turns WHERE ${filter}`,
    )
    .get() as {
    input: number | null;
    output: number | null;
    cache_read: number | null;
    cache_creation: number | null;
    turns: number;
    sessions: number;
  };

  return {
    input: row.input ?? 0,
    output: row.output ?? 0,
    cache_read: row.cache_read ?? 0,
    cache_creation: row.cache_creation ?? 0,
    turns: row.turns ?? 0,
    sessions: row.sessions ?? 0,
  };
}

// ─── New data shapes ──────────────────────────────────────────────────────────

export interface CacheStatsRow {
  model: string;
  total_input: number;
  total_cache_read: number;
  total_cache_creation: number;
  hit_ratio: number;        // cache_read / (input + cache_read), 0–1
  savings_usd: number;      // cost saved vs fully-uncached (read tokens cheaper than input)
}

export interface WhatIfRow {
  from_model: string;
  to_model: string;
  current_full_cost_usd: number;
  hypothetical_full_cost_usd: number;
  savings_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  turns: number;
}

export type AnomalyRule = 'SES001' | 'SES002' | 'SES003' | 'SES004';

export interface AnomalyRow {
  session_id: string;
  project_name: string;
  model: string;
  first_timestamp: string;
  last_timestamp: string;
  turn_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_creation: number;
  rule: AnomalyRule;
  detail: string;
}

// ─── Cache analytics ─────────────────────────────────────────────────────────

/**
 * Per-model cache hit ratio + estimated savings.
 * hit_ratio = cache_read / (input + cache_read)  (reads cost ~10% of input)
 * savings   = tokens that hit cache × (input_rate - cache_read_rate) / 1M
 *             using approximate flat rates: $3 input vs $0.30 read for Sonnet
 *             (we keep it simple — exact savings are shown in usageStats via pricing.ts)
 */
export async function queryCacheStats(period: StatsQuery['period']): Promise<CacheStatsRow[]> {
  const conn = await getDb();
  const filter = periodFilter(period);

  return conn
    .prepare(
      `SELECT
        model,
        SUM(input_tokens) AS total_input,
        SUM(cache_read_tokens) AS total_cache_read,
        SUM(cache_creation_tokens) AS total_cache_creation,
        CASE
          WHEN SUM(input_tokens) + SUM(cache_read_tokens) = 0 THEN 0
          ELSE ROUND(CAST(SUM(cache_read_tokens) AS REAL) / (SUM(input_tokens) + SUM(cache_read_tokens)), 4)
        END AS hit_ratio,
        0 AS savings_usd
       FROM turns
       WHERE ${filter} AND model != ''
       GROUP BY model
       ORDER BY total_cache_read DESC`,
    )
    .all() as CacheStatsRow[];
}

// ─── What-if calculator ───────────────────────────────────────────────────────

/**
 * Returns token totals for fromModel turns so the caller (usageStats.ts)
 * can compute actual cost deltas using pricing.ts.
 * We don't import pricing here to avoid circular deps.
 */
export async function queryWhatIfTokens(
  period: StatsQuery['period'],
  fromModel: string,
): Promise<{
  input: number; output: number; cache_read: number; cache_creation: number; turns: number;
} | null> {
  const conn = await getDb();
  const filter = periodFilter(period);

  const row = conn
    .prepare(
      `SELECT
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation,
        SUM(CASE WHEN stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turns
       FROM turns
       WHERE ${filter} AND LOWER(model) LIKE LOWER(?)`,
    )
    .get(`%${fromModel}%`) as { input: number | null; output: number | null; cache_read: number | null; cache_creation: number | null; turns: number } | undefined;

  if (!row || row.input === null) return null;
  return {
    input: row.input ?? 0,
    output: row.output ?? 0,
    cache_read: row.cache_read ?? 0,
    cache_creation: row.cache_creation ?? 0,
    turns: row.turns ?? 0,
  };
}

// ─── Session anomaly detection (inspired by Claudoscope SES001-SES004) ────────

const SES_COST_THRESHOLD = 25;    // SES001: session worth > $25 API cost
const SES_MSG_THRESHOLD = 200;    // SES002: > 200 visible turns
const SES_TOKEN_THRESHOLD = 5_000_000; // SES003: > 5M total tokens (incl. cache)
const SES_IDLE_DAYS = 7;          // SES004: idle 7+ days with 50+ turns

/**
 * Find sessions that hit any of the four health thresholds.
 * Cost computation uses a simplified rate ($5/M input, $25/M output) for all
 * models — accurate enough for anomaly detection. Precise costs are in pricing.ts.
 */
export async function querySessionAnomalies(period: StatsQuery['period']): Promise<AnomalyRow[]> {
  const conn = await getDb();
  const filter = periodFilter(period);

  const rows = conn
    .prepare(
      `SELECT
        s.session_id,
        s.project_name,
        s.model,
        s.first_timestamp,
        s.last_timestamp,
        SUM(CASE WHEN t.stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turn_count,
        SUM(t.input_tokens) AS total_input_tokens,
        SUM(t.output_tokens) AS total_output_tokens,
        SUM(t.cache_read_tokens) AS total_cache_read,
        SUM(t.cache_creation_tokens) AS total_cache_creation
       FROM sessions s
       LEFT JOIN turns t ON t.session_id = s.session_id AND ${filter.replace(/timestamp/g, 't.timestamp')}
       GROUP BY s.session_id
       HAVING turn_count > 0 OR total_input_tokens > 0`,
    )
    .all() as (Omit<AnomalyRow, 'rule' | 'detail'>)[];

  const anomalies: AnomalyRow[] = [];
  const now = Date.now();

  for (const row of rows) {
    // Approximate cost: use Opus rates as conservative upper bound ($5 input / $25 output per 1M)
    const approxCost = (row.total_input_tokens * 5 + row.total_output_tokens * 25) / 1_000_000;
    const totalTokens = row.total_input_tokens + row.total_output_tokens + row.total_cache_read + row.total_cache_creation;
    const lastMs = new Date(row.last_timestamp).getTime();
    const idleDays = isNaN(lastMs) ? 0 : (now - lastMs) / 86_400_000;

    // Apply rules in severity order — only the most severe fires per session
    if (approxCost >= SES_COST_THRESHOLD) {
      anomalies.push({ ...row, rule: 'SES001', detail: `Coût estimé ≥ $${SES_COST_THRESHOLD} (~$${approxCost.toFixed(2)})` });
    } else if (row.turn_count >= SES_MSG_THRESHOLD) {
      anomalies.push({ ...row, rule: 'SES002', detail: `${row.turn_count} turns (seuil: ${SES_MSG_THRESHOLD})` });
    } else if (totalTokens >= SES_TOKEN_THRESHOLD) {
      const m = totalTokens >= 1_000_000 ? (totalTokens / 1_000_000).toFixed(1) + 'M' : Math.round(totalTokens / 1000) + 'K';
      anomalies.push({ ...row, rule: 'SES003', detail: `${m} tokens cumulés (seuil: 5M)` });
    } else if (idleDays >= SES_IDLE_DAYS && row.turn_count >= 50) {
      anomalies.push({ ...row, rule: 'SES004', detail: `Inactive depuis ${Math.round(idleDays)}j avec ${row.turn_count} turns` });
    }
  }

  // Sort by rule severity (SES001 first), then by last_timestamp desc
  const ORDER: Record<AnomalyRule, number> = { SES001: 0, SES002: 1, SES003: 2, SES004: 3 };
  anomalies.sort((a, b) => ORDER[a.rule] - ORDER[b.rule] || b.last_timestamp.localeCompare(a.last_timestamp));

  return anomalies.slice(0, 25); // Cap at 25 to avoid flooding
}

// ─── Breakdown queries (v3.9.0) ───────────────────────────────────────────────

/**
 * Token usage and cost broken down by task category.
 * Returns rows sorted by (input + output) desc.
 */
export async function queryCategoryBreakdown(period: StatsQuery['period']): Promise<CategoryBreakdownRow[]> {
  const conn = await getDb();
  const filter = periodFilter(period);

  return conn
    .prepare(
      `SELECT
        COALESCE(NULLIF(category, ''), 'general') AS category,
        COUNT(*) AS turn_count,
        SUM(input_tokens) AS total_input,
        SUM(output_tokens) AS total_output,
        SUM(cache_read_tokens) AS total_cache_read,
        SUM(cache_creation_tokens) AS total_cache_creation
       FROM turns
       WHERE ${filter}
       GROUP BY category
       ORDER BY total_input + total_output DESC`,
    )
    .all() as CategoryBreakdownRow[];
}

/**
 * MCP server usage breakdown.
 * Parses the mcp_tools JSON column with json_each() to aggregate per server.
 */
export async function queryMcpBreakdown(period: StatsQuery['period']): Promise<McpBreakdownRow[]> {
  const conn = await getDb();
  const filter = periodFilter(period);

  // We extract each {server, tool} entry from the mcp_tools JSON array
  // json_each returns one row per array element; we parse .value as JSON
  return conn
    .prepare(
      `SELECT
        json_extract(j.value, '$.server') AS server,
        COUNT(*) AS call_count,
        COUNT(DISTINCT t.id) AS turn_count
       FROM turns t, json_each(NULLIF(t.mcp_tools, '')) j
       WHERE ${filter.replace(/timestamp/g, 't.timestamp')}
         AND t.mcp_tools != '' AND t.mcp_tools IS NOT NULL
       GROUP BY server
       ORDER BY call_count DESC
       LIMIT 50`,
    )
    .all() as McpBreakdownRow[];
}

/**
 * Core (non-MCP) tool usage breakdown.
 * Parses the core_tools JSON column.
 */
export async function queryCoreToolBreakdown(period: StatsQuery['period']): Promise<CoreToolBreakdownRow[]> {
  const conn = await getDb();
  const filter = periodFilter(period);

  return conn
    .prepare(
      `SELECT
        j.value AS tool,
        COUNT(*) AS call_count
       FROM turns t, json_each(NULLIF(t.core_tools, '')) j
       WHERE ${filter.replace(/timestamp/g, 't.timestamp')}
         AND t.core_tools != '' AND t.core_tools IS NOT NULL
       GROUP BY tool
       ORDER BY call_count DESC
       LIMIT 50`,
    )
    .all() as CoreToolBreakdownRow[];
}

// ─── Dashboard data ───────────────────────────────────────────────────────────

export async function queryDashboardData(): Promise<DashboardData> {
  const conn = await getDb();

  const modelRows = conn
    .prepare("SELECT DISTINCT model FROM turns WHERE model != '' ORDER BY model")
    .all() as { model: string }[];
  const all_models = modelRows.map((r) => r.model);

  const daily_by_model = conn
    .prepare(
      `SELECT
        date(timestamp) AS day,
        model,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation,
        SUM(CASE WHEN stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turns
       FROM turns
       WHERE timestamp >= datetime('now', '-90 days')
       GROUP BY day, model
       ORDER BY day ASC`,
    )
    .all() as DailyModelRow[];

  const sessionRows = conn
    .prepare(
      `SELECT s.session_id, s.project_name, s.first_timestamp, s.last_timestamp, s.model,
              SUM(CASE WHEN t.stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turn_count,
              SUM(t.input_tokens) AS total_input_tokens,
              SUM(t.output_tokens) AS total_output_tokens,
              SUM(t.cache_read_tokens) AS total_cache_read,
              SUM(t.cache_creation_tokens) AS total_cache_creation
       FROM sessions s
       LEFT JOIN turns t ON t.session_id = s.session_id
       GROUP BY s.session_id
       ORDER BY s.last_timestamp DESC`,
    )
    .all() as SessionRow[];

  const sessions_all: SessionDashRow[] = sessionRows.map((s) => {
    const first = new Date(s.first_timestamp).getTime();
    const last = new Date(s.last_timestamp).getTime();
    const duration_min =
      isNaN(first) || isNaN(last) ? 0 : Math.round(((last - first) / 60000) * 10) / 10;
    const tokens = {
      input: s.total_input_tokens,
      output: s.total_output_tokens,
      cacheRead: s.total_cache_read,
      cacheCreation: s.total_cache_creation,
    };
    return {
      session_id: s.session_id.substring(0, 8),
      project: s.project_name,
      last: s.last_timestamp.replace('T', ' ').substring(0, 16),
      last_date: s.last_timestamp.substring(0, 10),
      duration_min,
      model: s.model,
      turns: s.turn_count,
      input: s.total_input_tokens,
      output: s.total_output_tokens,
      cache_read: s.total_cache_read,
      cache_creation: s.total_cache_creation,
      cost_full: calculateFullApiCost(s.model, tokens),
      cost_useful: calculateUsefulCost(s.model, { input: s.total_input_tokens, output: s.total_output_tokens }),
    };
  });

  // Per-model aggregated costs (for cost table) — precomputed server-side
  const modelAggRows = conn
    .prepare(
      `SELECT
        model,
        SUM(CASE WHEN stop_reason IN ('end_turn','stop_sequence') THEN 1 ELSE 0 END) AS turns,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation
       FROM turns
       WHERE timestamp >= datetime('now', '-90 days') AND model != ''
       GROUP BY model
       ORDER BY input + output DESC`,
    )
    .all() as { model: string; turns: number; input: number; output: number; cache_read: number; cache_creation: number }[];

  const model_costs: ModelCostRow[] = modelAggRows.map((r) => ({
    model: r.model,
    turns: r.turns,
    input: r.input,
    output: r.output,
    cache_read: r.cache_read,
    cache_creation: r.cache_creation,
    cost_full: calculateFullApiCost(r.model, { input: r.input, output: r.output, cacheRead: r.cache_read, cacheCreation: r.cache_creation }),
    cost_useful: calculateUsefulCost(r.model, { input: r.input, output: r.output }),
  }));

  // Cache stats + anomalies + breakdown tabs
  const cache_stats = await queryCacheStats('all');
  const anomalies = await querySessionAnomalies('all');
  const category_breakdown = await queryCategoryBreakdown('all');
  const mcp_breakdown = await queryMcpBreakdown('all');
  const core_tool_breakdown = await queryCoreToolBreakdown('all');

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return {
    all_models,
    daily_by_model,
    sessions_all,
    model_costs,
    cache_stats,
    anomalies,
    category_breakdown,
    mcp_breakdown,
    core_tool_breakdown,
    max_price_monthly: 100,
    generated_at: now,
  };
}
