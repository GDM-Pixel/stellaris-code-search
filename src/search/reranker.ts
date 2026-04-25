import type { HybridResult } from './hybrid.js';

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';

export type RerankProvider = 'off' | 'voyage' | 'cohere';

function getProvider(): RerankProvider {
  const p = (process.env.RERANK_PROVIDER ?? 'off').toLowerCase() as RerankProvider;
  return p;
}

/**
 * Re-rank top results using a cross-encoder model.
 * Only active when RERANK_PROVIDER env is set to 'voyage' or 'cohere'.
 * Falls back silently to original order if re-ranking fails.
 */
export async function rerank(query: string, results: HybridResult[], topN: number): Promise<HybridResult[]> {
  const provider = getProvider();
  if (provider === 'off' || results.length === 0) return results.slice(0, topN);

  try {
    if (provider === 'voyage') return await rerankVoyage(query, results, topN);
    if (provider === 'cohere') return await rerankCohere(query, results, topN);
  } catch (err: any) {
    console.error(`[Stellaris] Re-ranking failed (${provider}), using original order: ${err.message}`);
  }

  return results.slice(0, topN);
}

async function rerankVoyage(query: string, results: HybridResult[], topN: number): Promise<HybridResult[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY required for Voyage reranking');

  const model = process.env.VOYAGE_RERANK_MODEL ?? 'rerank-2';
  const documents = results.map(r => r.content);

  const response = await fetch(VOYAGE_RERANK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ query, documents, model, top_k: topN }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage rerank error (${response.status}): ${err}`);
  }

  const data = await response.json() as { data: { index: number; relevance_score: number }[] };

  return data.data.map(item => ({
    ...results[item.index],
    score: item.relevance_score,
  }));
}

async function rerankCohere(query: string, results: HybridResult[], topN: number): Promise<HybridResult[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY required for Cohere reranking');

  const model = process.env.COHERE_RERANK_MODEL ?? 'rerank-v3.5';
  const documents = results.map(r => ({ text: r.content }));

  const response = await fetch(COHERE_RERANK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Client-Name': 'stellaris-mcp',
    },
    body: JSON.stringify({ query, documents, model, top_n: topN }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Cohere rerank error (${response.status}): ${err}`);
  }

  const data = await response.json() as { results: { index: number; relevance_score: number }[] };

  return data.results.map(item => ({
    ...results[item.index],
    score: item.relevance_score,
  }));
}
