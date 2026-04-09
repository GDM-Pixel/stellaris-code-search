import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbSchema } from './types.js';

const SCHEMA_FILENAME = 'db-schema.json';
const VECTORS_DIR = '.vectors';

function getSchemaPath(projectRoot: string): string {
  return join(projectRoot, VECTORS_DIR, SCHEMA_FILENAME);
}

/**
 * Read the DB schema snapshot from .vectors/db-schema.json.
 * Returns null if not found.
 */
export async function readDbSchema(projectRoot: string): Promise<DbSchema | null> {
  const schemaPath = getSchemaPath(projectRoot);
  try {
    const raw = await readFile(schemaPath, 'utf-8');
    return JSON.parse(raw) as DbSchema;
  } catch {
    return null;
  }
}

/**
 * Write the DB schema snapshot to .vectors/db-schema.json.
 * Creates the .vectors directory if it doesn't exist.
 */
export async function writeDbSchema(projectRoot: string, schema: DbSchema): Promise<void> {
  const vectorsDir = join(projectRoot, VECTORS_DIR);
  await mkdir(vectorsDir, { recursive: true });
  const schemaPath = getSchemaPath(projectRoot);
  await writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf-8');
}

/**
 * Return the age of the snapshot in milliseconds, or null if no snapshot exists.
 */
export async function getSnapshotAgeMs(projectRoot: string): Promise<number | null> {
  const schema = await readDbSchema(projectRoot);
  if (!schema) return null;
  return Date.now() - new Date(schema.meta.snapshot_at).getTime();
}
