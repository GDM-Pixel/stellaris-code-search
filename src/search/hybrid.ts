/**
 * Hybrid search: combines FTS5 (keyword) + LanceDB (vector) results
 * using Reciprocal Rank Fusion (RRF).
 *
 * RRF formula: score(doc) = Σ 1/(k + rank_i(doc)) for each retriever i
 * With k=60 (standard constant).
 */

import { searchByVector, type SearchResult } from '../store/lancedb.js';
import { searchFTS, hasFTSIndex, type FTSSearchResult } from '../store/fts.js';
import { embedText } from '../indexer/embedder.js';

const RRF_K = 60;

export interface HybridResult {
  id: string;
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  line_start: number;
  line_end: number;
  score: number;
  sources: ('vector' | 'fts')[];
}

interface SearchFilter {
  chunkType?: string;
  chunkTypeNot?: string;
}

/**
 * Hybrid search combining vector + FTS results via RRF.
 * Falls back gracefully: vector-only if no FTS index, FTS-only if no API key.
 */
export async function hybridSearch(
  projectRoot: string,
  query: string,
  limit: number,
  filter?: SearchFilter,
): Promise<HybridResult[]> {
  const hasFTS = await hasFTSIndex(projectRoot);
  const hasApiKey = !!process.env.OPENAI_API_KEY;

  // Run available searches in parallel
  const [vectorResults, ftsResults] = await Promise.all([
    hasApiKey ? runVectorSearch(projectRoot, query, limit * 2, filter) : Promise.resolve([]),
    hasFTS ? searchFTS(projectRoot, query, limit * 2, filter) : Promise.resolve([]),
  ]);

  // If only one source available, return it directly
  if (vectorResults.length === 0 && ftsResults.length === 0) return [];
  if (vectorResults.length === 0) return ftsToHybrid(ftsResults, limit);
  if (ftsResults.length === 0) return vectorToHybrid(vectorResults, limit);

  // Merge via RRF
  return mergeRRF(vectorResults, ftsResults, limit, query);
}

/**
 * Run vector search and normalize to a common format.
 */
async function runVectorSearch(
  projectRoot: string,
  query: string,
  limit: number,
  filter?: SearchFilter,
): Promise<SearchResult[]> {
  const queryVector = await embedText(query);

  // Whitelist chunk_type values to prevent injection via filter strings
  const VALID_CHUNK_TYPES = new Set([
    'function', 'component', 'hook', 'class', 'type', 'export',
    'module', 'doc_section', 'method', 'struct', 'trait', 'impl', 'rule', 'element',
  ]);

  let lanceFilter: string | undefined;
  if (filter?.chunkType && VALID_CHUNK_TYPES.has(filter.chunkType)) {
    lanceFilter = `chunk_type = '${filter.chunkType}'`;
  } else if (filter?.chunkTypeNot && VALID_CHUNK_TYPES.has(filter.chunkTypeNot)) {
    lanceFilter = `chunk_type != '${filter.chunkTypeNot}'`;
  }

  return searchByVector(projectRoot, queryVector, limit, lanceFilter);
}

/**
 * Merge vector + FTS results using Reciprocal Rank Fusion.
 * Applies query-aware boosting for better identifier matching.
 */
function mergeRRF(
  vectorResults: SearchResult[],
  ftsResults: FTSSearchResult[],
  limit: number,
  query: string,
): HybridResult[] {
  const scores = new Map<string, { score: number; sources: Set<'vector' | 'fts'>; result: HybridResult }>();

  // Score vector results
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    const rrfScore = 1 / (RRF_K + i + 1);
    const key = r.id;

    const entry = scores.get(key) ?? {
      score: 0,
      sources: new Set<'vector' | 'fts'>(),
      result: {
        id: r.id,
        file_path: r.file_path,
        chunk_type: r.chunk_type,
        name: r.name,
        content: r.content,
        line_start: r.line_start,
        line_end: r.line_end,
        score: 0,
        sources: [],
      },
    };

    entry.score += rrfScore;
    entry.sources.add('vector');
    scores.set(key, entry);
  }

  // Score FTS results
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const rrfScore = 1 / (RRF_K + i + 1);
    const key = r.id;

    const entry = scores.get(key) ?? {
      score: 0,
      sources: new Set<'vector' | 'fts'>(),
      result: {
        id: r.id,
        file_path: r.file_path,
        chunk_type: r.chunk_type,
        name: r.name,
        content: r.content,
        line_start: r.line_start,
        line_end: r.line_end,
        score: 0,
        sources: [],
      },
    };

    entry.score += rrfScore;
    entry.sources.add('fts');
    scores.set(key, entry);
  }

  // Apply query-aware kind boosting
  const boost = detectQueryKindBoost(query);

  // Sort by score (boosted), return top N
  return [...scores.values()]
    .map(entry => {
      let finalScore = entry.score;

      // Boost if chunk type matches query pattern
      if (boost && entry.result.chunk_type === boost.kind) {
        finalScore *= boost.factor;
      }

      // Bonus for exact name match in FTS
      if (entry.sources.has('fts') && entry.result.name.toLowerCase().includes(query.toLowerCase())) {
        finalScore *= 1.5;
      }

      return {
        ...entry.result,
        score: Math.round(finalScore * 10000) / 10000,
        sources: [...entry.sources],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Query-aware kind boosting heuristics (inspired by code-review-graph).
 * PascalCase → likely searching for a class/type.
 * snake_case or camelCase → likely searching for a function.
 */
function detectQueryKindBoost(query: string): { kind: string; factor: number } | null {
  const trimmed = query.trim();

  // Single token that looks like PascalCase (e.g., "AuthService", "UserModel")
  if (/^[A-Z][a-zA-Z0-9]+$/.test(trimmed)) {
    return { kind: 'class', factor: 1.3 };
  }

  // Single token that looks like an interface/type (e.g., "IUser", "SearchResult")
  if (/^(I[A-Z]|T[A-Z])/.test(trimmed) || trimmed.endsWith('Type') || trimmed.endsWith('Interface')) {
    return { kind: 'type', factor: 1.3 };
  }

  // snake_case or camelCase starting with lowercase
  if (/^[a-z][a-zA-Z0-9]*(_[a-z][a-zA-Z0-9]*)*$/.test(trimmed)) {
    return { kind: 'function', factor: 1.2 };
  }

  return null;
}

/**
 * Convert FTS-only results to HybridResult format.
 */
function ftsToHybrid(results: FTSSearchResult[], limit: number): HybridResult[] {
  return results.slice(0, limit).map((r, i) => ({
    id: r.id,
    file_path: r.file_path,
    chunk_type: r.chunk_type,
    name: r.name,
    content: r.content,
    line_start: r.line_start,
    line_end: r.line_end,
    score: Math.round((1 / (RRF_K + i + 1)) * 10000) / 10000,
    sources: ['fts' as const],
  }));
}

/**
 * Convert vector-only results to HybridResult format.
 */
function vectorToHybrid(results: SearchResult[], limit: number): HybridResult[] {
  return results.slice(0, limit).map((r, i) => ({
    id: r.id,
    file_path: r.file_path,
    chunk_type: r.chunk_type,
    name: r.name,
    content: r.content,
    line_start: r.line_start,
    line_end: r.line_end,
    score: Math.round((1 / (RRF_K + i + 1)) * 10000) / 10000,
    sources: ['vector' as const],
  }));
}
