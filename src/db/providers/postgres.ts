import type { DbProvider } from './base.js';
import type {
  DbSchema,
  DbTable,
  DbColumn,
  DbIndex,
  DbForeignKey,
  DbRlsPolicy,
  DbEnum,
} from '../types.js';
import { maskConnectionString } from './detect.js';

const STELLARIS_VERSION = '3.3.0';

/**
 * PostgreSQL provider — uses the `pg` npm package (dynamically imported).
 * Supports Supabase, Neon, PlanetScale-Postgres, and vanilla PostgreSQL.
 */
export class PostgresProvider implements DbProvider {
  private connectionString: string;
  private client: any = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async testConnection(): Promise<void> {
    const client = await this.getClient();
    await client.query('SELECT 1');
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    let pg: any;
    try {
      pg = await import('pg');
    } catch {
      throw new Error(
        'The `pg` package is required for PostgreSQL introspection. Run: npm install pg',
      );
    }
    const Client = pg.default?.Client ?? pg.Client;
    const client = new Client({ connectionString: this.connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    this.client = client;
    console.error(`[Stellaris DB] Connected to ${maskConnectionString(this.connectionString)}`);
    return client;
  }

  async introspect(schemas: string[] = ['public']): Promise<DbSchema> {
    const client = await this.getClient();

    // Extract database name from connection string
    const dbMatch = this.connectionString.match(/\/([^/?]+)(\?|$)/);
    const database = dbMatch?.[1] ?? 'unknown';
    const hostMatch = this.connectionString.match(/@([^:/]+)/);
    const connection_host = hostMatch?.[1];

    const schemaList = schemas.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');

    // 1. Enums
    const enumsResult = await client.query(`
      SELECT t.typname AS name, n.nspname AS schema,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname IN (${schemaList})
      GROUP BY t.typname, n.nspname
      ORDER BY n.nspname, t.typname
    `);
    const enums: DbEnum[] = enumsResult.rows.map((r: any) => ({
      name: r.name,
      schema: r.schema,
      values: r.values,
    }));

    // Build enum name lookup: 'schema.name' -> enum name
    const enumLookup = new Map<string, string>(enums.map(e => [`${e.schema}.${e.name}`, e.name]));

    // 2. Tables (with row count estimate and comment)
    const tablesResult = await client.query(`
      SELECT c.table_name AS name, c.table_schema AS schema,
             obj_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, 'pg_class') AS comment,
             (SELECT reltuples::bigint FROM pg_class pc
              JOIN pg_namespace pn ON pc.relnamespace = pn.oid
              WHERE pc.relname = c.table_name AND pn.nspname = c.table_schema) AS row_count_estimate
      FROM information_schema.tables c
      WHERE c.table_schema IN (${schemaList})
        AND c.table_type = 'BASE TABLE'
      ORDER BY c.table_schema, c.table_name
    `);

    // 3. Columns for all tables
    const columnsResult = await client.query(`
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name AS name,
        c.udt_name AS udt_name,
        c.data_type AS type,
        c.is_nullable = 'YES' AS nullable,
        c.column_default AS default_value,
        c.is_generated <> 'NEVER' AS is_generated,
        c.ordinal_position,
        pg_catalog.col_description(
          (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass::oid,
          c.ordinal_position
        ) AS comment,
        n.nspname AS enum_schema,
        t.typname AS enum_name_raw
      FROM information_schema.columns c
      LEFT JOIN pg_type t ON t.typname = c.udt_name
      LEFT JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname IN (${schemaList})
        AND t.typcategory = 'E'
      WHERE c.table_schema IN (${schemaList})
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `);

    // 4. Primary keys
    const pkResult = await client.query(`
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema IN (${schemaList})
      ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position
    `);

    // 5. Unique constraints (to flag columns)
    const uniqueResult = await client.query(`
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE'
        AND tc.table_schema IN (${schemaList})
    `);

    // 6. Indexes (from pg_indexes, excluding PK/unique constraints already captured)
    const indexResult = await client.query(`
      SELECT
        schemaname AS schema,
        tablename AS table_name,
        indexname AS name,
        indexdef,
        ix.indisunique AS is_unique
      FROM pg_indexes pi
      JOIN pg_class ic ON ic.relname = pi.indexname
      JOIN pg_index ix ON ix.indexrelid = ic.oid
      WHERE pi.schemaname IN (${schemaList})
      ORDER BY pi.schemaname, pi.tablename, pi.indexname
    `);

    // 7. Foreign keys
    const fkResult = await client.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        tc.constraint_name AS name,
        kcu.column_name,
        ccu.table_schema AS references_schema,
        ccu.table_name AS references_table,
        ccu.column_name AS references_column,
        rc.delete_rule AS on_delete,
        rc.update_rule AS on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema IN (${schemaList})
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
    `);

    // 8. RLS policies (pg_policies view — available in PG 10+)
    let rlsResult: any = { rows: [] };
    try {
      rlsResult = await client.query(`
        SELECT schemaname AS schema, tablename AS table_name, policyname AS name,
               cmd AS command, qual AS using_expr, with_check, roles, permissive
        FROM pg_policies
        WHERE schemaname IN (${schemaList})
        ORDER BY schemaname, tablename, policyname
      `);
    } catch {
      // pg_policies might not exist on older PG versions
    }

    // Build lookup structures
    const pkSet = new Set<string>();
    for (const r of pkResult.rows) {
      pkSet.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);
    }

    const uniqueSet = new Set<string>();
    for (const r of uniqueResult.rows) {
      uniqueSet.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);
    }

    // Group columns by table
    const columnsByTable = new Map<string, DbColumn[]>();
    for (const r of columnsResult.rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!columnsByTable.has(key)) columnsByTable.set(key, []);
      const isPk = pkSet.has(`${r.table_schema}.${r.table_name}.${r.name}`);
      const isUniq = uniqueSet.has(`${r.table_schema}.${r.table_name}.${r.name}`);
      const enumRef = r.enum_name_raw && r.enum_schema
        ? enumLookup.get(`${r.enum_schema}.${r.enum_name_raw}`)
        : undefined;

      columnsByTable.get(key)!.push({
        name: r.name,
        type: r.type === 'USER-DEFINED' ? r.udt_name : r.type,
        nullable: r.nullable,
        default_value: r.default_value ?? undefined,
        is_primary_key: isPk,
        is_unique: isUniq || isPk,
        is_generated: r.is_generated,
        comment: r.comment ?? undefined,
        enum_name: enumRef,
      });
    }

    // Group primary keys by table
    const pkByTable = new Map<string, string[]>();
    for (const r of pkResult.rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!pkByTable.has(key)) pkByTable.set(key, []);
      pkByTable.get(key)!.push(r.column_name);
    }

    // Group indexes by table
    const indexesByTable = new Map<string, DbIndex[]>();
    for (const r of indexResult.rows) {
      const key = `${r.schema}.${r.table_name}`;
      if (!indexesByTable.has(key)) indexesByTable.set(key, []);
      // Extract column names from indexdef via simple regex
      const colMatch = r.indexdef.match(/\((.+)\)$/);
      const cols = colMatch ? colMatch[1].split(',').map((c: string) => c.trim().split(' ')[0]) : [];
      // Extract method from indexdef
      const methodMatch = r.indexdef.match(/USING (\w+)/i);
      indexesByTable.get(key)!.push({
        name: r.name,
        columns: cols,
        is_unique: r.is_unique,
        type: methodMatch?.[1]?.toLowerCase() ?? 'btree',
      });
    }

    // Group foreign keys by table
    const fkByTable = new Map<string, Map<string, DbForeignKey>>();
    for (const r of fkResult.rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!fkByTable.has(key)) fkByTable.set(key, new Map());
      const fkMap = fkByTable.get(key)!;
      if (!fkMap.has(r.name)) {
        fkMap.set(r.name, {
          name: r.name,
          columns: [],
          references_table: r.references_table,
          references_schema: r.references_schema,
          references_columns: [],
          on_delete: r.on_delete,
          on_update: r.on_update,
        });
      }
      const fk = fkMap.get(r.name)!;
      fk.columns.push(r.column_name);
      fk.references_columns.push(r.references_column);
    }

    // Group RLS policies by table
    const rlsByTable = new Map<string, DbRlsPolicy[]>();
    for (const r of rlsResult.rows) {
      const key = `${r.schema}.${r.table_name}`;
      if (!rlsByTable.has(key)) rlsByTable.set(key, []);
      rlsByTable.get(key)!.push({
        name: r.name,
        command: r.command as DbRlsPolicy['command'],
        using: r.using_expr ?? undefined,
        with_check: r.with_check ?? undefined,
        roles: Array.isArray(r.roles) ? r.roles : [r.roles],
        permissive: r.permissive === 'PERMISSIVE',
      });
    }

    // Assemble tables
    const tables: DbTable[] = tablesResult.rows.map((r: any) => {
      const key = `${r.schema}.${r.name}`;
      return {
        name: r.name,
        schema: r.schema,
        comment: r.comment ?? undefined,
        columns: columnsByTable.get(key) ?? [],
        primary_key: pkByTable.get(key) ?? [],
        indexes: indexesByTable.get(key) ?? [],
        foreign_keys: Array.from(fkByTable.get(key)?.values() ?? []),
        rls_policies: rlsByTable.get(key) ?? [],
        row_count_estimate: r.row_count_estimate != null ? Number(r.row_count_estimate) : undefined,
      };
    });

    return {
      meta: {
        provider: 'postgres',
        source: 'introspection',
        database,
        connection_host,
        snapshot_at: new Date().toISOString(),
        stellaris_version: STELLARIS_VERSION,
      },
      enums,
      tables,
    };
  }
}
