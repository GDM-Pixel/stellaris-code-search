import OpenAI from 'openai';
import { CHUNK_CONFIG } from '../config/defaults.js';
import type { Chunk } from './chunker.js';

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

let client: OpenAI | null = null;

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
 * Embed a single text string
 */
export async function embedText(text: string): Promise<number[]> {
  const openai = getClient();
  const response = await openai.embeddings.create({
    model: CHUNK_CONFIG.embeddingModel,
    input: text,
  });
  return response.data[0].embedding;
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
      // Retry individual chunks in the failed batch
      for (const chunk of batch) {
        try {
          const single = await openai.embeddings.create({
            model: CHUNK_CONFIG.embeddingModel,
            input: chunk.content,
          });
          results.push({ ...chunk, vector: single.data[0].embedding });
        } catch (retryError: any) {
          console.error(`[Stellaris] Skipping chunk ${chunk.name}: ${retryError.message}`);
        }
      }
    }
  }

  return results;
}
