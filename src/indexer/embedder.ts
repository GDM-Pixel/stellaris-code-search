import OpenAI from 'openai';
import { CHUNK_CONFIG } from '../config/defaults.js';
import type { Chunk } from './chunker.js';

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

let client: OpenAI | null = null;

// LRU cache for query embeddings — avoids redundant API calls for repeated queries
const queryEmbedCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 100;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for semantic search and indexing. Set it in your environment or .env file.');
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Embed a single text string with LRU cache (for search queries).
 */
export async function embedText(text: string): Promise<number[]> {
  if (queryEmbedCache.has(text)) return queryEmbedCache.get(text)!;

  const openai = getClient();
  const response = await openai.embeddings.create({
    model: CHUNK_CONFIG.embeddingModel,
    input: text,
  });
  const vector = response.data[0].embedding;

  // Evict oldest entry if at capacity
  if (queryEmbedCache.size >= QUERY_CACHE_MAX) {
    queryEmbedCache.delete(queryEmbedCache.keys().next().value!);
  }
  queryEmbedCache.set(text, vector);

  return vector;
}

/**
 * Embed chunks in batches
 */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  const openai = getClient();
  const results: EmbeddedChunk[] = [];
  const batchSize = CHUNK_CONFIG.embeddingBatchSize;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    try {
      const response = await openai.embeddings.create({
        model: CHUNK_CONFIG.embeddingModel,
        input: texts,
      });

      for (let j = 0; j < batch.length; j++) {
        results.push({
          ...batch[j],
          vector: response.data[j].embedding,
        });
      }

      const progress = Math.min(i + batchSize, chunks.length);
      console.error(`[Stellaris] Embedded ${progress}/${chunks.length} chunks`);
    } catch (error: any) {
      console.error(`[Stellaris] Embedding batch failed (offset ${i}):`, error.message);
      // Retry individual chunks with exponential backoff
      // Avoids hammering the API immediately after a rate limit (429)
      for (const chunk of batch) {
        let embedded = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
            }
            const single = await openai.embeddings.create({
              model: CHUNK_CONFIG.embeddingModel,
              input: chunk.content,
            });
            results.push({ ...chunk, vector: single.data[0].embedding });
            embedded = true;
            break;
          } catch (retryError: any) {
            if (attempt === 2) {
              console.error(`[Stellaris] Skipping chunk ${chunk.name}: ${retryError.message}`);
            }
          }
        }
        if (!embedded) {
          // Skip chunk — indexing continues without it
        }
      }
    }
  }

  return results;
}
