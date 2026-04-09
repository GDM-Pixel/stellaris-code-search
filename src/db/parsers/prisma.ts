import { readFile } from 'node:fs/promises';
import type { DbSchema, DbTable, DbColumn, DbEnum, DbForeignKey } from '../types.js';

const STELLARIS_VERSION = '3.3.0';

/**
 * Parse a Prisma schema.prisma file into a normalized DbSchema.
 * Supports models, enums, and basic field types.
 */
export async function parsePrismaSchema(filePath: string, projectRoot: string): Promise<DbSchema> {
  const content = await readFile(filePath, 'utf-8');

  const tables: DbTable[] = [];
  const enums: DbEnum[] = [];

  // Extract datasource provider
  const providerMatch = content.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/);
  const prismaProvider = providerMatch?.[1] ?? 'postgresql';
  const dbProvider: DbSchema['meta']['provider'] =
    prismaProvider.includes('mysql') ? 'mysql' :
    prismaProvider.includes('sqlite') ? 'sqlite' :
    'postgres';

  const database = projectRoot.split(/[\/]/).pop() ?? 'unknown';

  // Parse enums
  const enumRe = /^enum\s+(\w+)\s*\{([^}]+)\}/gm;
  let enumMatch: RegExpExecArray | null;
  while ((enumMatch = enumRe.exec(content)) !== null) {
    const enumName = enumMatch[1];
    const valuesBlock = enumMatch[2];
    const values = valuesBlock
      .split('\n')
      .map(l => l.trim().split(/[\s@]/)[0])
      .filter(v => v && !v.startsWith('//') && !v.startsWith('@@'));
    if (values.length > 0) {
      enums.push({ name: enumName, schema: 'public', values });
    }
  }

  const enumNames = new Set(enums.map(e => e.name));

  // Parse models
  const modelRe = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
  let modelMatch: RegExpExecArray | null;
  while ((modelMatch = modelRe.exec(content)) !== null) {
    const modelName = modelMatch[1];
    const fieldsBlock = modelMatch[2];

    const columns: DbColumn[] = [];
    const primaryKey: string[] = [];
    const foreignKeys: Map<string, DbForeignKey> = new Map();

    // Composite primary key
    const compositeIdMatch = fieldsBlock.match(/@@id\(\[([^\]]+)\]\)/);
    if (compositeIdMatch) {
      compositeIdMatch[1].split(',').map(s => s.trim()).forEach(col => primaryKey.push(col));
    }

    const lines = fieldsBlock.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

      const fieldRe = /^(\w+)\s+(\w+)(\?)?\s*(.*)?$/;
      const fieldMatch = trimmed.match(fieldRe);
      if (!fieldMatch) continue;

      const [, fieldName, rawType, optionalMark, decorators = ''] = fieldMatch;

      // Skip relation fields that reference other models
      if (!decorators.includes('@') && !enumNames.has(rawType)) {
        if (/^[A-Z]/.test(rawType) && !isPrismaScalar(rawType)) continue;
      }

      const nullable = optionalMark === '?' || decorators.includes('@default(null)');
      const isId = decorators.includes('@id');
      const isUnique = decorators.includes('@unique') || isId;
      const isGenerated = decorators.includes('@default(autoincrement())') ||
        decorators.includes('@default(cuid())') ||
        decorators.includes('@default(uuid())') ||
        decorators.includes('@updatedAt');

      const defaultMatch = decorators.match(/@default\(([^)]+)\)/);
      const defaultValue = defaultMatch ? defaultMatch[1] : undefined;

      const pgType = enumNames.has(rawType) ? rawType : mapPrismaTypeToPg(rawType);

      columns.push({
        name: fieldName,
        type: pgType,
        nullable,
        default_value: defaultValue,
        is_primary_key: isId,
        is_unique: isUnique,
        is_generated: isGenerated,
        enum_name: enumNames.has(rawType) ? rawType : undefined,
      });

      if (isId) primaryKey.push(fieldName);

      // Detect foreign key via @relation
      if (decorators.includes('@relation')) {
        const relMatch = decorators.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/);
        if (relMatch) {
          const fkFields = relMatch[1].split(',').map(s => s.trim());
          const refFields = relMatch[2].split(',').map(s => s.trim());
          foreignKeys.set(fieldName, {
            name: `fk_${toSnakeCase(modelName)}_${fkFields.join('_')}`,
            columns: fkFields,
            references_table: toSnakeCase(rawType),
            references_schema: 'public',
            references_columns: refFields,
            on_delete: 'NO ACTION',
            on_update: 'NO ACTION',
          });
        }
      }
    }

    tables.push({
      name: toSnakeCase(modelName),
      schema: 'public',
      columns: columns.filter(c => !c.name.startsWith('_')),
      primary_key: [...new Set(primaryKey)],
      indexes: [],
      foreign_keys: Array.from(foreignKeys.values()),
      rls_policies: [],
    });
  }

  return {
    meta: {
      provider: dbProvider,
      source: 'prisma',
      database,
      snapshot_at: new Date().toISOString(),
      stellaris_version: STELLARIS_VERSION,
    },
    enums,
    tables,
  };
}

function isPrismaScalar(type: string): boolean {
  return ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Decimal', 'BigInt'].includes(type);
}

function mapPrismaTypeToPg(prismaType: string): string {
  const map: Record<string, string> = {
    String: 'text',
    Int: 'integer',
    Float: 'double precision',
    Boolean: 'boolean',
    DateTime: 'timestamp with time zone',
    Json: 'jsonb',
    Bytes: 'bytea',
    Decimal: 'numeric',
    BigInt: 'bigint',
  };
  return map[prismaType] ?? prismaType.toLowerCase();
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`));
}
