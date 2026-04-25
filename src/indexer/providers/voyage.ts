import type { EmbeddingProvider } from './base.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const BATCH_SIZE = 8; // Voyage recommends smaller batches for code

const MODEL_DIMS: Record<string, number> = {
  'voyage-code-3': 1024,
  'voyage-3': 1024,
  'voyage-3-lite': 512,
};

export class VoyageProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly model: string;
  readonly dims: number;

  private apiKey: string;

  constructor(model = 'voyage-code-3') {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) {
      throw new Error('VOYAGE_API_KEY is required for the Voyage embedding provider.');
    }
    this.apiKey = key;
    this.model = model;
    this.dims = MODEL_DIMS[model] ?? 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      const response = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch, input_type: 'document' }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Voyage API error (${response.status}): ${err}`);
      }

      const data = await response.json() as { data: { embedding: number[] }[] };
      for (const item of data.data) {
        results.push(item.embedding);
      }

      console.error(`[Stellaris] Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks via Voyage`);
    }

    return results;
  }
}
