/**
 * Graph store: SQLite-backed directed dependency graph.
 * Stores file→file edges with import names.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface DependencyEdge {
  source_file: string;
  target_file: string;
  import_names: string[];
}

export interface FileNode {
  file_path: string;
  depth: number;
}

let db: Database.Database | null = null;

function dbPath(projectRoot: string): string {
  return join(projectRoot, '.vectors', 'graph.db');
}

/**
 * Connect to (or create) the graph SQLite database.
 */
export async function connectGraph(projectRoot: string): Promise<Database.Database> {
  if (db) return db;

  const dir = join(projectRoot, '.vectors');
  await mkdir(dir, { recursive: true });

  db = new Database(dbPath(projectRoot));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      source_file TEXT NOT NULL,
      target_file TEXT NOT NULL,
      import_names TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (source_file, target_file)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_file);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_file);
  `);

  return db;
}

/**
 * Set all edges for a source file (replaces existing).
 * Called during indexing after imports are resolved.
 */
export async function setFileEdges(
  projectRoot: string,
  sourceFile: string,
  targets: { targetFile: string; importNames: string[] }[],
): Promise<void> {
  const conn = await connectGraph(projectRoot);

  const deleteStmt = conn.prepare('DELETE FROM edges WHERE source_file = ?');
  const insertStmt = conn.prepare(
    'INSERT OR REPLACE INTO edges (source_file, target_file, import_names) VALUES (?, ?, ?)'
  );

  const transaction = conn.transaction(() => {
    deleteStmt.run(sourceFile);
    for (const { targetFile, importNames } of targets) {
      insertStmt.run(sourceFile, targetFile, JSON.stringify(importNames));
    }
  });

  transaction();
}

/**
 * Delete all edges for a file (as source or target).
 */
export async function deleteFileEdges(projectRoot: string, filePath: string): Promise<void> {
  const conn = await connectGraph(projectRoot);
  conn.prepare('DELETE FROM edges WHERE source_file = ? OR target_file = ?').run(filePath, filePath);
}

/**
 * Get files that the given file imports (dependencies / outgoing edges).
 */
export async function getDependencies(projectRoot: string, filePath: string): Promise<DependencyEdge[]> {
  const conn = await connectGraph(projectRoot);
  const rows = conn.prepare(
    'SELECT source_file, target_file, import_names FROM edges WHERE source_file = ?'
  ).all(filePath) as { source_file: string; target_file: string; import_names: string }[];

  return rows.map(r => ({
    source_file: r.source_file,
    target_file: r.target_file,
    import_names: JSON.parse(r.import_names),
  }));
}

/**
 * Get files that import the given file (dependents / incoming edges).
 */
export async function getDependents(projectRoot: string, filePath: string): Promise<DependencyEdge[]> {
  const conn = await connectGraph(projectRoot);
  const rows = conn.prepare(
    'SELECT source_file, target_file, import_names FROM edges WHERE target_file = ?'
  ).all(filePath) as { source_file: string; target_file: string; import_names: string }[];

  return rows.map(r => ({
    source_file: r.source_file,
    target_file: r.target_file,
    import_names: JSON.parse(r.import_names),
  }));
}

/**
 * Get graph stats.
 */
export async function getGraphStats(projectRoot: string): Promise<{
  total_edges: number;
  total_files: number;
}> {
  const conn = await connectGraph(projectRoot);

  const edgeCount = (conn.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number }).cnt;
  const fileCount = (conn.prepare(
    'SELECT COUNT(DISTINCT f) as cnt FROM (SELECT source_file as f FROM edges UNION SELECT target_file as f FROM edges)'
  ).get() as { cnt: number }).cnt;

  return { total_edges: edgeCount, total_files: fileCount };
}

/**
 * Check if graph has any data.
 */
export async function hasGraph(projectRoot: string): Promise<boolean> {
  const path = dbPath(projectRoot);
  if (!existsSync(path)) return false;

  try {
    const conn = await connectGraph(projectRoot);
    const row = conn.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number };
    return row.cnt > 0;
  } catch {
    return false;
  }
}
