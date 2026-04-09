import { readFile } from 'node:fs/promises';
import type { DbSchema, DbTable, DbColumn, DbEnum } from '../types.js';

const STELLARIS_VERSION = '3.3.0';

/**
 * Parse a Supabase-generated database.types.ts file into a normalized DbSchema.
 *
 * Supabase generates types like:
 *   export type Database = {
 *     public: {
 *       Tables: {
 *         articles: {
 *           Row: { id: string; title: string; ... }
 *         }
 *       }
 *       Enums: {
 *         article_status: 'draft' | 'published' | 'archived'
 *       }
 *     }
 *   }
 */
export async function parseSupabaseTypes(filePath: string, projectRoot: string): Promise<DbSchema> {
  const content = await readFile(filePath, 'utf-8');

  const tables: DbTable[] = [];
  const enums: DbEnum[] = [];

  // Detect which schemas exist inside Database type
  const schemasFound = new Set<string>();
  const dbTypeMatch = content.match(/export\s+type\s+Database\s*=\s*\{([\s\S]*)\}/);
  if (dbTypeMatch) {
    const dbContent = dbTypeMatch[1];
    const topLevelKeyRe = /^\s{4}(\w+):\s*\{/gm;
    let tlMatch: RegExpExecArray | null;
    while ((tlMatch = topLevelKeyRe.exec(dbContent)) !== null) {
      schemasFound.add(tlMatch[1]);
    }
  }

  for (const schemaName of schemasFound.size > 0 ? schemasFound : ['public']) {
    const schemaRe = new RegExp(`\b${schemaName}:\s*\{([\s\S]*?)(?=\n {4}\w+:|$)`, 'g');
    const schemaBlock = schemaRe.exec(content);
    const schemaContent = schemaBlock?.[1] ?? '';

    // Parse Enums
    const enumBlockRe = /Enums:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
    const enumContentMatch = enumBlockRe.exec(schemaContent);
    if (enumContentMatch) {
      const enumContent = enumContentMatch[1];
      const enumEntryRe = /(\w+):\s*((?:'[^']*'\s*\|?\s*)+)/g;
      let enumEntry: RegExpExecArray | null;
      while ((enumEntry = enumEntryRe.exec(enumContent)) !== null) {
        const enumName = enumEntry[1];
        const valuesStr = enumEntry[2];
        const values = Array.from(valuesStr.matchAll(/'([^']*)'/g)).map(m => m[1]);
        if (values.length > 0) {
          enums.push({ name: enumName, schema: schemaName, values });
        }
      }
    }

    // Parse Tables (Row blocks)
    const tablesBlockRe = /Tables:\s*\{([\s\S]*?)(?=\n\s{8}(?:Views|Functions|Enums|CompositeTypes):|$)/g;
    const tablesBlock = tablesBlockRe.exec(schemaContent);
    if (!tablesBlock) continue;

    const tablesContent = tablesBlock[1];
    const tableNameRe = /\b(\w+):\s*\{/g;
    let tableNameMatch: RegExpExecArray | null;

    while ((tableNameMatch = tableNameRe.exec(tablesContent)) !== null) {
      const tableName = tableNameMatch[1];
      if (['Row', 'Insert', 'Update', 'Relationships'].includes(tableName)) continue;

      const afterTable = tablesContent.slice(tableNameMatch.index);
      const rowMatch2 = afterTable.match(/\bRow:\s*\{([^}]+)\}/);
      if (!rowMatch2) continue;

      const rowContent = rowMatch2[1];
      const columns: DbColumn[] = [];

      const colRe = /(\w+):\s*([^;\n]+)/g;
      let colMatch: RegExpExecArray | null;
      while ((colMatch = colRe.exec(rowContent)) !== null) {
        const colName = colMatch[1];
        const rawType = colMatch[2].trim().replace(/;$/, '').trim();
        const nullable = rawType.includes('| null') || rawType.includes('null |');
        const cleanType = rawType
          .replace(/\s*\|\s*null/g, '')
          .replace(/null\s*\|\s*/g, '')
          .trim();

        columns.push({
          name: colName,
          type: mapTsTypeToPg(cleanType),
          nullable,
          is_primary_key: colName === 'id',
          is_unique: colName === 'id',
          is_generated: false,
        });
      }

      if (columns.length === 0) continue;

      tables.push({
        name: tableName,
        schema: schemaName,
        columns,
        primary_key: columns.filter(c => c.name === 'id').map(c => c.name),
        indexes: [],
        foreign_keys: [],
        rls_policies: [],
      });
    }
  }

  const database = projectRoot.split(/[\/]/).pop() ?? 'unknown';

  return {
    meta: {
      provider: 'postgres',
      source: 'types',
      database,
      snapshot_at: new Date().toISOString(),
      stellaris_version: STELLARIS_VERSION,
    },
    enums,
    tables,
  };
}

function mapTsTypeToPg(tsType: string): string {
  const t = tsType.trim().replace(/"/g, '').replace(/'/g, '');
  if (t === 'string') return 'text';
  if (t === 'number') return 'numeric';
  if (t === 'boolean') return 'boolean';
  if (t === 'Json' || t === 'json') return 'jsonb';
  if (t.startsWith('Database[')) return 'enum';
  return t;
}
