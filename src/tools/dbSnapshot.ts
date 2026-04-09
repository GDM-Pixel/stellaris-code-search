import { findProjectRoot } from '../indexer/scanner.js';
import { runDbSnapshot } from '../db/snapshot.js';
import { loadStellarisRc, saveStellarisRc } from '../config/stellarisrc.js';

export async function handleDbSnapshot(args: Record<string, unknown>) {
  const projectRoot = findProjectRoot(process.cwd());

  const connectionString = typeof args.connection_string === 'string' ? args.connection_string.trim() : undefined;
  const provider = (args.provider as 'postgres' | 'mysql' | 'sqlite' | 'auto') ?? 'auto';
  const schemas = Array.isArray(args.schemas)
    ? (args.schemas as string[])
    : typeof args.schemas === 'string'
    ? args.schemas.split(',').map(s => s.trim())
    : ['public'];
  const saveConnection = args.save_connection === true;

  // Optionally persist connection string to .stellarisrc
  if (saveConnection && connectionString) {
    const rc = await loadStellarisRc(projectRoot);
    (rc as any).db_connection_string = connectionString;
    (rc as any).db_provider = provider === 'auto' ? undefined : provider;
    await saveStellarisRc(projectRoot, rc);
  }

  try {
    const result = await runDbSnapshot(projectRoot, {
      connectionString,
      provider,
      schemas,
    });

    const lines = [
      `Database schema snapshot saved to .vectors/db-schema.json`,
      ``,
      `Provider : ${result.provider}`,
      `Source   : ${result.source}`,
      `Database : ${result.database}`,
      `Tables   : ${result.tables}`,
      `Enums    : ${result.enums}`,
      `Timestamp: ${result.snapshot_at}`,
      ``,
      `Use db_schema to browse the schema, or db_search to find tables/columns by concept.`,
    ];

    if (saveConnection && connectionString) {
      lines.push(``, `Connection string saved to .stellarisrc (db_connection_string).`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `db_snapshot failed: ${error.message}` }],
      isError: true,
    };
  }
}
