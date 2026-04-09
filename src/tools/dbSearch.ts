import { findProjectRoot } from '../indexer/scanner.js';
import { readDbSchema } from '../db/schema-store.js';
import type { DbTable } from '../db/types.js';

interface SearchHit {
  table: string;
  schema: string;
  column?: string;
  type?: string;
  reason: string;
  score: number;
}

/**
 * Score a table/column against a set of query tokens.
 * Returns a score > 0 if there's a match, 0 otherwise.
 */
function scoreMatch(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower === token) {
      score += 3; // exact match
    } else if (lower.includes(token)) {
      score += 1; // partial match
    }
  }
  return score;
}

function buildHitsForTable(table: DbTable, tokens: string[]): SearchHit[] {
  const hits: SearchHit[] = [];

  // Score the table name and comment
  const nameScore = scoreMatch(table.name, tokens);
  const commentScore = table.comment ? scoreMatch(table.comment, tokens) : 0;
  const tableScore = nameScore + commentScore;

  if (tableScore > 0) {
    hits.push({
      table: table.name,
      schema: table.schema,
      reason: nameScore > 0 ? `table name matches` : `table comment matches: "${table.comment}"`,
      score: tableScore * 2, // table-level matches get a bonus
    });
  }

  // Score each column
  for (const col of table.columns) {
    const colNameScore = scoreMatch(col.name, tokens);
    const colTypeScore = scoreMatch(col.type, tokens);
    const colCommentScore = col.comment ? scoreMatch(col.comment, tokens) : 0;
    const colEnumScore = col.enum_name ? scoreMatch(col.enum_name, tokens) : 0;
    const colScore = colNameScore + colTypeScore + colCommentScore + colEnumScore;

    if (colScore > 0) {
      const reasons: string[] = [];
      if (colNameScore > 0) reasons.push(`column name matches`);
      if (colTypeScore > 0) reasons.push(`type '${col.type}' matches`);
      if (colCommentScore > 0) reasons.push(`column comment matches`);
      if (colEnumScore > 0) reasons.push(`enum '${col.enum_name}' matches`);

      hits.push({
        table: table.name,
        schema: table.schema,
        column: col.name,
        type: col.type,
        reason: reasons.join(', '),
        score: colScore,
      });
    }
  }

  return hits;
}

function formatHit(hit: SearchHit): string {
  if (hit.column) {
    return `${hit.schema}.${hit.table}.${hit.column} (${hit.type}) — ${hit.reason}`;
  }
  return `${hit.schema}.${hit.table} — ${hit.reason}`;
}

export async function handleDbSearch(args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return {
      content: [{ type: 'text', text: 'query parameter is required.' }],
    };
  }

  const limit = typeof args.limit === 'number' ? args.limit : 10;
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

  // Tokenize the query: lowercase, split on whitespace and common separators
  const tokens = query
    .toLowerCase()
    .split(/[\s_\-.,/]+/)
    .filter(t => t.length >= 2);

  if (tokens.length === 0) {
    return {
      content: [{ type: 'text', text: 'Query too short. Please use at least 2-character terms.' }],
    };
  }

  // Collect and rank hits
  const allHits: SearchHit[] = [];
  for (const table of schema.tables) {
    allHits.push(...buildHitsForTable(table, tokens));
  }

  // Also search enum values
  for (const e of schema.enums) {
    const enumScore = scoreMatch(e.name, tokens);
    if (enumScore > 0) {
      allHits.push({
        table: `[enum] ${e.name}`,
        schema: e.schema,
        reason: `enum name matches (values: ${e.values.join(', ')})`,
        score: enumScore,
      });
    }
    for (const val of e.values) {
      const valScore = scoreMatch(val, tokens);
      if (valScore > 0) {
        allHits.push({
          table: `[enum] ${e.name}`,
          schema: e.schema,
          reason: `enum value '${val}' matches`,
          score: valScore,
        });
      }
    }
  }

  // Sort by score descending, deduplicate table-level entries
  allHits.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const deduped: SearchHit[] = [];
  for (const hit of allHits) {
    const key = hit.column ? `${hit.schema}.${hit.table}.${hit.column}` : `${hit.schema}.${hit.table}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(hit);
      if (deduped.length >= limit) break;
    }
  }

  if (deduped.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No matches found for "${query}" in the database schema (${schema.tables.length} tables searched).\nTry db_schema to browse all tables.`,
      }],
    };
  }

  const resultLines = [
    `Found ${deduped.length} result${deduped.length > 1 ? 's' : ''} for "${query}" in ${schema.meta.database} (${schema.meta.provider}):`,
    '',
    ...deduped.map(h => `• ${formatHit(h)}`),
    '',
    `Schema: ${schema.meta.snapshot_at} | Use db_schema with table parameter for full column details.`,
  ];

  return {
    content: [{ type: 'text', text: resultLines.join('\n') }],
  };
}
