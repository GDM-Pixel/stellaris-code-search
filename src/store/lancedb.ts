import * as lancedb from '@lancedb/lancedb';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { LANCEDB_TABLE_NAME } from '../config/defaults.js';
import type { EmbeddedChunk } from '../indexer/embedder.js';

export interface SearchResult {
  id: string;
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  line_start: number;
  line_end: number;
  _distance: number;
}

let db: lancedb.Connection | null = null;

/**
 * Connect to (or create) the LanceDB database in .vectors/
 */
export async function connectStore(projectRoot: string): Promise<lancedb.Connection> {
  if (db) return db;

  const dbPath = join(projectRoot, '.vectors', 'lancedb');
  await mkdir(dbPath, { recursive: true });

  db = await lancedb.connect(dbPath);
  return db;
}

/**
 * Close the LanceDB connection cleanly (call on SIGTERM/SIGINT).
 */
export function closeLanceStore(): void {
  // LanceDB Connection doesn't expose a close() method in the JS SDK,
  // but releasing the reference allows GC to clean up open handles.
  db = null;
}

/**
 * Get or create the code_chunks table.
 * If dims changes (provider switch), drop and recreate the table.
 */
async function getTable(connection: lancedb.Connection, dims?: number): Promise<lancedb.Table> {
  const tableNames = await connection.tableNames();
  const effectiveDims = dims ?? 1536;

  if (tableNames.includes(LANCEDB_TABLE_NAME)) {
    const existing = await connection.openTable(LANCEDB_TABLE_NAME);
    // Check dims via schema — if table exists but dims mismatch, drop and recreate
    try {
      const schema = await existing.schema();
      const vectorField = schema.fields.find((f: any) => f.name === 'vector');
      if (vectorField && (vectorField.type as any)?.listSize !== effectiveDims) {
        console.error(`[Stellaris] LanceDB dims mismatch (stored=${(vectorField.type as any).listSize}, current=${effectiveDims}) — recreating table`);
        await connection.dropTable(LANCEDB_TABLE_NAME);
      } else {
        return existing;
      }
    } catch {
      return existing;
    }
  }

  // Create with a dummy record to define schema, then delete it
  const table = await connection.createTable(LANCEDB_TABLE_NAME, [
    {
      id: '__init__',
      file_path: '',
      chunk_type: '',
      name: '',
      content: '',
      line_start: 0,
      line_end: 0,
      vector: new Array(effectiveDims).fill(0),
    },
  ]);
  await table.delete('id = "__init__"');

  return table;
}

/**
 * Add embedded chunks to the store.
 * dims must match the embedding provider configured at index time.
 */
export async function addChunks(
  projectRoot: string,
  chunks: EmbeddedChunk[],
  dims?: number,
): Promise<void> {
  if (chunks.length === 0) return;

  const connection = await connectStore(projectRoot);
  const table = await getTable(connection, dims);

  const records = chunks.map((c) => ({
    id: c.id,
    file_path: c.file_path,
    chunk_type: c.chunk_type,
    name: c.name,
    content: c.content,
    line_start: c.line_start,
    line_end: c.line_end,
    vector: c.vector,
  }));

  await table.add(records);
  console.error(`[Stellaris] Stored ${records.length} chunks in LanceDB`);
}

/**
 * Delete all chunks for a given file path
 */
export async function deleteChunksByFile(
  projectRoot: string,
  filePath: string,
): Promise<void> {
  const connection = await connectStore(projectRoot);
  const table = await getTable(connection);
  // Use escaped value to avoid SQL injection from paths with special chars
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await table.delete(`file_path = "${escaped}"`);
}

/**
 * Semantic search by vector
 */
export async function searchByVector(
  projectRoot: string,
  queryVector: number[],
  limit: number,
  filter?: string,
): Promise<SearchResult[]> {
  const connection = await connectStore(projectRoot);
  const table = await getTable(connection, queryVector.length);

  let query = table.search(queryVector).limit(limit);

  if (filter) {
    // filter values are validated as whitelisted enum strings before reaching here
    query = query.where(filter);
  }

  const results = await query.toArray();

  return results.map((r: any) => ({
    id: r.id,
    file_path: r.file_path,
    chunk_type: r.chunk_type,
    name: r.name,
    content: r.content,
    line_start: r.line_start,
    line_end: r.line_end,
    _distance: r._distance ?? 0,
  }));
}

/**
 * Check if index exists and has data
 */
export async function hasIndex(projectRoot: string): Promise<boolean> {
  try {
    const connection = await connectStore(projectRoot);
    const tableNames = await connection.tableNames();
    return tableNames.includes(LANCEDB_TABLE_NAME);
  } catch {
    return false;
  }
}
