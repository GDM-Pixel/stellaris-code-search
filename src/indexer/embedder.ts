import type { EmbeddingProvider } from './providers/base.js';
import { OpenAIProvider } from './providers/openai.js';
import { VoyageProvider } from './providers/voyage.js';
import { OllamaProvider } from './providers/ollama.js';
import type { Chunk } from './chunker.js';

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dims: number;
}

// LRU cache for query embeddings — avoids redundant API calls for repeated queries
const queryEmbedCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 100;

let activeProvider: EmbeddingProvider | null = null;

/**
 * Build the embedding provider from environment variables.
 * Priority: EMBEDDING_PROVIDER env > default (openai).
 */
export function createProvider(): EmbeddingProvider {
  const providerName = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();

  switch (providerName) {
    case 'voyage':
      return new VoyageProvider(process.env.VOYAGE_MODEL);
    case 'ollama': {
      const dims = process.env.OLLAMA_DIMS ? parseInt(process.env.OLLAMA_DIMS, 10) : undefined;
      return new OllamaProvider(process.env.OLLAMA_MODEL, dims);
    }
    case 'openai':
    default:
      return new OpenAIProvider(process.env.OPENAI_EMBEDDING_MODEL);
  }
}

function getProvider(): EmbeddingProvider {
  if (!activeProvider) {
    activeProvider = createProvider();
  }
  return activeProvider;
}

/** Returns the current embedding configuration (provider + model + dims). */
export function getEmbeddingConfig(): EmbeddingConfig {
  const p = getProvider();
  return { provider: p.name, model: p.model, dims: p.dims };
}

/**
 * Embed a single text string with LRU cache (for search queries).
 */
export async function embedText(text: string): Promise<number[]> {
  if (queryEmbedCache.has(text)) return queryEmbedCache.get(text)!;

  const provider = getProvider();
  const [vector] = await provider.embed([text]);

  if (queryEmbedCache.size >= QUERY_CACHE_MAX) {
    queryEmbedCache.delete(queryEmbedCache.keys().next().value!);
  }
  queryEmbedCache.set(text, vector);

  return vector;
}

/**
 * Embed chunks in batches using the active provider.
 */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];

  const provider = getProvider();
  const texts = chunks.map(c => c.content);

  const vectors = await provider.embed(texts);

  return chunks.map((chunk, i) => ({
    ...chunk,
    vector: vectors[i] ?? new Array(provider.dims).fill(0),
  }));
}
