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

    CREATE TABLE IF NOT EXISTS boundary_violations (
      source_file TEXT NOT NULL,
      target_file TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      from_pattern TEXT NOT NULL,
      to_pattern TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (source_file, target_file, rule_name)
    );

    CREATE INDEX IF NOT EXISTS idx_violations_source ON boundary_violations(source_file);

    CREATE TABLE IF NOT EXISTS doc_links (
      doc_file TEXT NOT NULL,
      symbol TEXT NOT NULL,
      target_file TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      PRIMARY KEY (doc_file, symbol, target_file, line_number)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_links_symbol ON doc_links(symbol);
    CREATE INDEX IF NOT EXISTS idx_doc_links_target ON doc_links(target_file);
    CREATE INDEX IF NOT EXISTS idx_doc_links_doc ON doc_links(doc_file);
  `);

  return db;
}

export interface BoundaryViolation {
  source_file: string;
  target_file: string;
  rule_name: string;
  from_pattern: string;
  to_pattern: string;
  reason: string;
}

/**
 * Replace boundary violations for a given source file.
 */
export async function setBoundaryViolations(
  projectRoot: string,
  sourceFile: string,
  violations: Omit<BoundaryViolation, 'source_file'>[],
): Promise<void> {
  const conn = await connectGraph(projectRoot);
  const del = conn.prepare('DELETE FROM boundary_violations WHERE source_file = ?');
  const ins = conn.prepare(
    'INSERT OR REPLACE INTO boundary_violations (source_file, target_file, rule_name, from_pattern, to_pattern, reason) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const tx = conn.transaction(() => {
    del.run(sourceFile);
    for (const v of violations) {
      ins.run(sourceFile, v.target_file, v.rule_name, v.from_pattern, v.to_pattern, v.reason);
    }
  });
  tx();
}

export async function deleteBoundaryViolations(projectRoot: string, sourceFile: string): Promise<void> {
  const conn = await connectGraph(projectRoot);
  conn.prepare('DELETE FROM boundary_violations WHERE source_file = ? OR target_file = ?').run(sourceFile, sourceFile);
}

export async function getAllBoundaryViolations(projectRoot: string): Promise<BoundaryViolation[]> {
  const conn = await connectGraph(projectRoot);
  return conn.prepare(
    'SELECT source_file, target_file, rule_name, from_pattern, to_pattern, reason FROM boundary_violations ORDER BY source_file, target_file'
  ).all() as BoundaryViolation[];
}

export interface DocLink {
  doc_file: string;
  symbol: string;
  target_file: string;
  line_number: number;
}

/**
 * Replace doc_links for a given doc_file.
 */
export async function setDocLinks(
  projectRoot: string,
  docFile: string,
  links: Omit<DocLink, 'doc_file'>[],
): Promise<void> {
  const conn = await connectGraph(projectRoot);
  const del = conn.prepare('DELETE FROM doc_links WHERE doc_file = ?');
  const ins = conn.prepare(
    'INSERT OR REPLACE INTO doc_links (doc_file, symbol, target_file, line_number) VALUES (?, ?, ?, ?)'
  );
  const tx = conn.transaction(() => {
    del.run(docFile);
    for (const l of links) {
      ins.run(docFile, l.symbol, l.target_file, l.line_number);
    }
  });
  tx();
}

export async function deleteDocLinks(projectRoot: string, docFile: string): Promise<void> {
  const conn = await connectGraph(projectRoot);
  conn.prepare('DELETE FROM doc_links WHERE doc_file = ? OR target_file = ?').run(docFile, docFile);
}

/**
 * Find docs that reference a given symbol or target file.
 */
export async function findDocLinksForSymbol(projectRoot: string, symbol: string): Promise<DocLink[]> {
  const conn = await connectGraph(projectRoot);
  return conn.prepare(
    'SELECT doc_file, symbol, target_file, line_number FROM doc_links WHERE symbol = ? ORDER BY doc_file, line_number'
  ).all(symbol) as DocLink[];
}

export async function findDocLinksForFile(projectRoot: string, targetFile: string): Promise<DocLink[]> {
  const conn = await connectGraph(projectRoot);
  return conn.prepare(
    'SELECT doc_file, symbol, target_file, line_number FROM doc_links WHERE target_file = ? ORDER BY doc_file, line_number'
  ).all(targetFile) as DocLink[];
}

export async function getDocLinksStats(projectRoot: string): Promise<{ total_links: number; total_docs: number; total_symbols: number }> {
  const conn = await connectGraph(projectRoot);
  const total = (conn.prepare('SELECT COUNT(*) as c FROM doc_links').get() as { c: number }).c;
  const docs = (conn.prepare('SELECT COUNT(DISTINCT doc_file) as c FROM doc_links').get() as { c: number }).c;
  const symbols = (conn.prepare('SELECT COUNT(DISTINCT symbol) as c FROM doc_links').get() as { c: number }).c;
  return { total_links: total, total_docs: docs, total_symbols: symbols };
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
 * Get all edges in the graph (used for full-graph visualization).
 */
export async function getAllEdges(projectRoot: string): Promise<DependencyEdge[]> {
  const conn = await connectGraph(projectRoot);
  const rows = conn.prepare(
    'SELECT source_file, target_file, import_names FROM edges'
  ).all() as { source_file: string; target_file: string; import_names: string }[];

  return rows.map(r => ({
    source_file: r.source_file,
    target_file: r.target_file,
    import_names: JSON.parse(r.import_names),
  }));
}

/**
 * Close the graph DB connection cleanly (call on SIGTERM/SIGINT).
 */
export function closeGraphStore(): void {
  if (db) {
    db.close();
    db = null;
  }
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
