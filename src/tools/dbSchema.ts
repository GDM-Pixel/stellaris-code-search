import { findProjectRoot } from '../indexer/scanner.js';
import { readDbSchema, getSnapshotAgeMs } from '../db/schema-store.js';
import type { DbSchema, DbTable } from '../db/types.js';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

type OutputFormat = 'full' | 'compact' | 'sql';

function formatCompact(tables: DbTable[]): string {
  const lines: string[] = [];
  for (const table of tables) {
    lines.push(`\n## ${table.schema}.${table.name}${table.comment ? ` — ${table.comment}` : ''}${table.row_count_estimate !== undefined && table.row_count_estimate >= 0 ? ` (~${table.row_count_estimate.toLocaleString()} rows)` : ''}`);
    for (const col of table.columns) {
      const flags: string[] = [];
      if (col.is_primary_key) flags.push('PK');
      if (col.is_unique) flags.push('UNIQUE');
      if (!col.nullable) flags.push('NOT NULL');
      if (col.default_value) flags.push(`DEFAULT ${col.default_value}`);
      if (col.is_generated) flags.push('GENERATED');
      lines.push(`  ${col.name} ${col.type}${flags.length ? ' [' + flags.join(', ') + ']' : ''}${col.comment ? ' — ' + col.comment : ''}`);
    }
    if (table.foreign_keys.length > 0) {
      lines.push('  Foreign keys:');
      for (const fk of table.foreign_keys) {
        lines.push(`    ${fk.columns.join(', ')} -> ${fk.references_schema}.${fk.references_table}(${fk.references_columns.join(', ')}) ON DELETE ${fk.on_delete}`);
      }
    }
  }
  return lines.join('\n');
}

function formatSql(tables: DbTable[]): string {
  const parts: string[] = [];
  for (const table of tables) {
    const cols = table.columns.map(col => {
      let def = `  ${col.name} ${col.type}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.default_value) def += ` DEFAULT ${col.default_value}`;
      return def;
    });
    if (table.primary_key.length > 0) {
      cols.push(`  PRIMARY KEY (${table.primary_key.join(', ')})`);
    }
    for (const fk of table.foreign_keys) {
      cols.push(`  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.references_schema}.${fk.references_table}(${fk.references_columns.join(', ')}) ON DELETE ${fk.on_delete}`);
    }
    parts.push(`CREATE TABLE ${table.schema}.${table.name} (\n${cols.join(',\n')}\n);`);
  }
  return parts.join('\n\n');
}

function formatFull(schema: DbSchema, tables: DbTable[], includeIndexes: boolean, includePolicies: boolean): string {
  const output: any = {
    meta: schema.meta,
    enums: schema.enums,
    tables: tables.map(t => ({
      ...t,
      indexes: includeIndexes ? t.indexes : undefined,
      rls_policies: includePolicies ? t.rls_policies : undefined,
    })),
  };
  return JSON.stringify(output, null, 2);
}

export async function handleDbSchema(args: Record<string, unknown>) {
  const projectRoot = findProjectRoot(process.cwd());
  const schema = await readDbSchema(projectRoot);

  if (!schema) {
    return {
      content: [{
        type: 'text',
        text: 'No database schema snapshot found. Run db_snapshot first to introspect your database.',
      }],
    };
  }

  const tableFilter = typeof args.table === 'string' ? args.table.toLowerCase() : null;
  const includeIndexes = args.include_indexes !== false;
  const includePolicies = args.include_policies !== false;
  const format: OutputFormat = (args.format as OutputFormat) ?? 'compact';

  let tables = tableFilter
    ? schema.tables.filter(t => t.name.toLowerCase() === tableFilter || `${t.schema}.${t.name}`.toLowerCase() === tableFilter)
    : schema.tables;

  if (tableFilter && tables.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `Table '${args.table}' not found in schema snapshot. Available tables: ${schema.tables.map(t => `${t.schema}.${t.name}`).join(', ')}`,
      }],
    };
  }

  // Build output
  const header = [
    `# Database Schema`,
    `Provider: ${schema.meta.provider} | Source: ${schema.meta.source} | DB: ${schema.meta.database}`,
    `Snapshot: ${schema.meta.snapshot_at}${schema.meta.connection_host ? ` | Host: ${schema.meta.connection_host}` : ''}`,
    `Tables: ${schema.tables.length} | Enums: ${schema.enums.length}`,
  ];

  let body: string;
  if (format === 'sql') {
    body = formatSql(tables);
  } else if (format === 'full') {
    body = formatFull(schema, tables, includeIndexes, includePolicies);
  } else {
    // compact (default)
    if (schema.enums.length > 0) {
      header.push('');
      header.push('## Enums');
      for (const e of schema.enums) {
        header.push(`  ${e.schema}.${e.name}: ${e.values.join(' | ')}`);
      }
    }
    body = formatCompact(tables);
  }

  // Staleness warning
  const ageMs = await getSnapshotAgeMs(projectRoot);
  let warning = '';
  if (ageMs !== null && ageMs > STALE_THRESHOLD_MS) {
    const ageHours = Math.floor(ageMs / 3_600_000);
    warning = `\n\n> Warning: Schema snapshot is ${ageHours}h old. Run db_snapshot to refresh.`;
  }

  return {
    content: [{
      type: 'text',
      text: header.join('\n') + '\n' + body + warning,
    }],
  };
}
