import { detectProvider, maskConnectionString } from './providers/detect.js';
import { PostgresProvider } from './providers/postgres.js';
import { writeDbSchema } from './schema-store.js';
import type { DbSchema } from './types.js';

export interface SnapshotOptions {
  connectionString?: string;
  provider?: 'postgres' | 'mysql' | 'sqlite' | 'auto';
  schemas?: string[];
}

export interface SnapshotResult {
  source: DbSchema['meta']['source'];
  tables: number;
  enums: number;
  provider: string;
  database: string;
  snapshot_at: string;
}

/**
 * Orchestrate DB schema introspection: detect provider, connect, introspect, save snapshot.
 * Falls back to local file parsing if no connection string is available.
 */
export async function runDbSnapshot(
  projectRoot: string,
  options: SnapshotOptions,
): Promise<SnapshotResult> {
  const connStr =
    options.connectionString ??
    process.env.DB_CONNECTION_STRING ??
    process.env.DATABASE_URL;

  // Determine provider
  let detectedProvider: 'postgres' | 'mysql' | 'sqlite';
  if (options.provider && options.provider !== 'auto') {
    detectedProvider = options.provider;
  } else if (connStr) {
    detectedProvider = detectProvider(connStr);
  } else {
    // No connection string — try local file parsers
    return runLocalFallback(projectRoot);
  }

  const schemas = options.schemas ?? ['public'];

  // Instantiate and run provider
  let schema: DbSchema;
  if (detectedProvider === 'postgres') {
    const provider = new PostgresProvider(connStr!);
    try {
      await provider.testConnection();
      schema = await provider.introspect(schemas);
    } finally {
      await provider.close();
    }
  } else {
    throw new Error(
      `Provider '${detectedProvider}' introspection is not yet implemented. ` +
      `Currently supported: postgres. Contributions welcome!`,
    );
  }

  await writeDbSchema(projectRoot, schema);

  console.error(
    `[Stellaris DB] Snapshot saved: ${schema.tables.length} tables, ${schema.enums.length} enums from ${maskConnectionString(connStr!)}`,
  );

  return {
    source: schema.meta.source,
    tables: schema.tables.length,
    enums: schema.enums.length,
    provider: schema.meta.provider,
    database: schema.meta.database,
    snapshot_at: schema.meta.snapshot_at,
  };
}

/**
 * Try to build a schema from local files (Prisma, database.types.ts, SQL migrations).
 * Imported lazily to avoid circular dependency issues.
 */
async function runLocalFallback(projectRoot: string): Promise<SnapshotResult> {
  // Dynamic import to keep the fallback tree-shaken when not needed
  const { detectLocalSchema } = await import('./parsers/detect.js');
  const { parseLocalSchema } = detectLocalSchema(projectRoot);

  if (!parseLocalSchema) {
    throw new Error(
      'No database connection string provided and no local schema files found.\n' +
      'Provide a connection string via:\n' +
      '  • db_snapshot parameter: connection_string\n' +
      '  • Environment variable: DB_CONNECTION_STRING or DATABASE_URL\n' +
      'Or ensure one of these files exists in the project:\n' +
      '  • prisma/schema.prisma\n' +
      '  • src/database.types.ts (Supabase generated types)\n' +
      '  • database.types.ts',
    );
  }

  const schema = await parseLocalSchema(projectRoot);
  await writeDbSchema(projectRoot, schema);

  console.error(
    `[Stellaris DB] Snapshot saved from local files: ${schema.tables.length} tables (source: ${schema.meta.source})`,
  );

  return {
    source: schema.meta.source,
    tables: schema.tables.length,
    enums: schema.enums.length,
    provider: schema.meta.provider,
    database: schema.meta.database,
    snapshot_at: schema.meta.snapshot_at,
  };
}
