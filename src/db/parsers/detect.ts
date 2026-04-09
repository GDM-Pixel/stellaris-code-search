import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbSchema } from '../types.js';

export interface LocalSchemaDetection {
  /** Parser function if a local schema file was found, null otherwise */
  parseLocalSchema: ((projectRoot: string) => Promise<DbSchema>) | null;
  /** Which file was detected */
  detectedFile?: string;
}

const CANDIDATE_FILES = [
  // Supabase generated types (most common)
  { path: 'src/database.types.ts', parser: 'supabase-types' },
  { path: 'database.types.ts', parser: 'supabase-types' },
  { path: 'types/database.types.ts', parser: 'supabase-types' },
  { path: 'lib/database.types.ts', parser: 'supabase-types' },
  // Prisma schema
  { path: 'prisma/schema.prisma', parser: 'prisma' },
  { path: 'schema.prisma', parser: 'prisma' },
];

/**
 * Detect which local schema file is available and return the appropriate parser.
 */
export function detectLocalSchema(projectRoot: string): LocalSchemaDetection {
  // This is called synchronously but checking is async — return a lazy async function
  return {
    parseLocalSchema: async (root: string) => {
      for (const candidate of CANDIDATE_FILES) {
        const fullPath = join(root, candidate.path);
        try {
          await access(fullPath);
          // File exists — load the appropriate parser
          if (candidate.parser === 'supabase-types') {
            const { parseSupabaseTypes } = await import('./supabase-types.js');
            return parseSupabaseTypes(fullPath, root);
          } else if (candidate.parser === 'prisma') {
            const { parsePrismaSchema } = await import('./prisma.js');
            return parsePrismaSchema(fullPath, root);
          }
        } catch {
          // File not found, try next
        }
      }
      throw new Error('No local schema files found.');
    },
  };
}
