import OpenAI from 'openai';
import type { EmbeddingProvider } from './base.js';
import { retryEmbed } from './base.js';

export class OpenAIProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dims: number;

  private client: OpenAI;

  constructor(model = 'text-embedding-3-small', dims = 1536) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for the OpenAI embedding provider.');
    }
    this.model = model;
    this.dims = dims;
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const batchSize = 20;
    const results: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      try {
        const response = await this.client.embeddings.create({ model: this.model, input: batch });
        for (let j = 0; j < batch.length; j++) {
          results[i + j] = response.data[j].embedding;
        }
        console.error(`[Stellaris] Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks`);
      } catch (err: any) {
        console.error(`[Stellaris] Batch embedding failed (offset ${i}): ${err.message}`);
        for (let j = 0; j < batch.length; j++) {
          const vector = await retryEmbed(
            async (t) => {
              const r = await this.client.embeddings.create({ model: this.model, input: t });
              return r.data[0].embedding;
            },
            batch[j],
            `chunk at index ${i + j}`,
          );
          results[i + j] = vector ?? new Array(this.dims).fill(0);
        }
      }
    }

    return results;
  }
}
