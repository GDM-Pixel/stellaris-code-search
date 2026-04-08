/**
 * Claude Code Usage Tracking — SQLite store
 * Database lives at ~/.claude/usage.db (global, not per-project)
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';

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
}

export interface TurnRow {
  session_id: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  tool_name: string;
  cwd: string;
  stop_reason: string;
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

export interface DashboardData {
  all_models: string[];
  daily_by_model: DailyModelRow[];
  sessions_all: {
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
  }[];
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

  // Retention: purge turns older than 180 days — dashboard only shows 90 days anyway.
  // processed_files entries are kept (they prevent re-scanning old JSONL files).
  db.exec(`DELETE FROM turns WHERE timestamp < datetime('now', '-180 days')`);
  db.exec(`DELETE FROM sessions WHERE last_timestamp < datetime('now', '-180 days')`);

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
         cache_read_tokens, cache_creation_tokens, tool_name, cwd, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.session_id,
      data.timestamp,
      data.model,
      data.input_tokens,
      data.output_tokens,
      data.cache_read_tokens,
      data.cache_creation_tokens,
      data.tool_name,
      data.cwd,
      data.stop_reason,
    );
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

  const sessions_all = sessionRows.map((s) => {
    const first = new Date(s.first_timestamp).getTime();
    const last = new Date(s.last_timestamp).getTime();
    const duration_min =
      isNaN(first) || isNaN(last) ? 0 : Math.round(((last - first) / 60000) * 10) / 10;
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
    };
  });

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return { all_models, daily_by_model, sessions_all, generated_at: now };
}
