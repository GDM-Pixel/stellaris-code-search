/**
 * Full-Text Search store using SQLite FTS5.
 * Complements the vector store for keyword/identifier exact matching.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface FTSRecord {
  id: string;
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  line_start: number;
  line_end: number;
}

export interface FTSSearchResult extends FTSRecord {
  rank: number;
}

let db: Database.Database | null = null;

function dbPath(projectRoot: string): string {
  return join(projectRoot, '.vectors', 'fts.db');
}

/**
 * Connect to (or create) the FTS SQLite database.
 */
export async function connectFTS(projectRoot: string): Promise<Database.Database> {
  if (db) return db;

  const dir = join(projectRoot, '.vectors');
  await mkdir(dir, { recursive: true });

  db = new Database(dbPath(projectRoot));
  db.pragma('journal_mode = WAL');

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      name,
      content,
      chunk_type,
      file_path,
      content='chunks',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS in sync with chunks table
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, name, content, chunk_type, file_path)
      VALUES (new.rowid, new.name, new.content, new.chunk_type, new.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, name, content, chunk_type, file_path)
      VALUES ('delete', old.rowid, old.name, old.content, old.chunk_type, old.file_path);
    END;

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
  `);

  return db;
}

/**
 * Add chunks to FTS index.
 */
export async function addFTSChunks(projectRoot: string, records: FTSRecord[]): Promise<void> {
  if (records.length === 0) return;

  const conn = await connectFTS(projectRoot);
  const insert = conn.prepare(`
    INSERT OR REPLACE INTO chunks (id, file_path, chunk_type, name, content, line_start, line_end)
    VALUES (@id, @file_path, @chunk_type, @name, @content, @line_start, @line_end)
  `);

  const transaction = conn.transaction((rows: FTSRecord[]) => {
    for (const row of rows) {
      insert.run(row);
    }
  });

  transaction(records);
}

/**
 * Delete all FTS chunks for a given file path.
 */
export async function deleteFTSChunksByFile(projectRoot: string, filePath: string): Promise<void> {
  const conn = await connectFTS(projectRoot);
  conn.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
}

/**
 * Full-text search using FTS5 BM25 ranking.
 * Returns results ranked by relevance score.
 */
export async function searchFTS(
  projectRoot: string,
  query: string,
  limit: number,
  filter?: { chunkType?: string; chunkTypeNot?: string },
): Promise<FTSSearchResult[]> {
  const conn = await connectFTS(projectRoot);

  // Sanitize query for FTS5: wrap tokens in double quotes to handle special chars
  const ftsQuery = sanitizeFTSQuery(query);

  let sql = `
    SELECT c.id, c.file_path, c.chunk_type, c.name, c.content, c.line_start, c.line_end,
           rank
    FROM chunks_fts
    JOIN chunks c ON c.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
  `;

  const params: (string | number)[] = [ftsQuery];

  if (filter?.chunkType) {
    sql += ` AND c.chunk_type = ?`;
    params.push(filter.chunkType);
  }
  if (filter?.chunkTypeNot) {
    sql += ` AND c.chunk_type != ?`;
    params.push(filter.chunkTypeNot);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    const rows = conn.prepare(sql).all(...params) as (FTSRecord & { rank: number })[];
    return rows.map(r => ({
      id: r.id,
      file_path: r.file_path,
      chunk_type: r.chunk_type,
      name: r.name,
      content: r.content,
      line_start: r.line_start,
      line_end: r.line_end,
      rank: r.rank,
    }));
  } catch {
    // FTS query syntax error — fall back to LIKE search
    return searchLike(conn, query, limit, filter);
  }
}

/**
 * Fallback LIKE search when FTS query fails.
 */
function searchLike(
  conn: Database.Database,
  query: string,
  limit: number,
  filter?: { chunkType?: string; chunkTypeNot?: string },
): FTSSearchResult[] {
  let sql = `SELECT id, file_path, chunk_type, name, content, line_start, line_end, 0 as rank FROM chunks WHERE (name LIKE ? OR content LIKE ?)`;

  const likePattern = `%${query}%`;
  const params: (string | number)[] = [likePattern, likePattern];

  if (filter?.chunkType) {
    sql += ` AND chunk_type = ?`;
    params.push(filter.chunkType);
  }
  if (filter?.chunkTypeNot) {
    sql += ` AND chunk_type != ?`;
    params.push(filter.chunkTypeNot);
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  return conn.prepare(sql).all(...params) as FTSSearchResult[];
}

/**
 * Return all distinct file_path values indexed in FTS.
 * Used by integrity checker to detect orphaned entries.
 */
export async function getIndexedFilePaths(projectRoot: string): Promise<Set<string>> {
  try {
    const conn = await connectFTS(projectRoot);
    const rows = conn.prepare('SELECT DISTINCT file_path FROM chunks').all() as { file_path: string }[];
    return new Set(rows.map(r => r.file_path));
  } catch {
    return new Set();
  }
}

/**
 * Check if FTS index exists and has data.
 */
export async function hasFTSIndex(projectRoot: string): Promise<boolean> {
  const path = dbPath(projectRoot);
  if (!existsSync(path)) return false;

  try {
    const conn = await connectFTS(projectRoot);
    const row = conn.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number };
    return row.cnt > 0;
  } catch {
    return false;
  }
}

/**
 * Sanitize a user query for FTS5.
 * Splits into tokens and wraps each in quotes to handle identifiers with special chars.
 * Joins with OR for broad matching.
 */
function sanitizeFTSQuery(query: string): string {
  // Split on whitespace, remove empty tokens
  const tokens = query.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length === 0) return '""';

  // If query looks like a single identifier (camelCase, snake_case, etc.), keep it whole
  if (tokens.length === 1) {
    return `"${tokens[0]}"`;
  }

  // Multiple tokens: use OR to match any
  return tokens.map(t => `"${t}"`).join(' OR ');
}
