import type { EmbeddingProvider } from './base.js';

const BATCH_SIZE = 10;

export class OllamaProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dims: number;

  private baseUrl: string;

  constructor(model = 'nomic-embed-text', dims = 768) {
    this.model = model;
    this.dims = dims;
    this.baseUrl = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      for (const text of batch) {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Ollama API error (${response.status}): ${err}`);
        }

        const data = await response.json() as { embedding: number[] };
        results.push(data.embedding);
      }

      console.error(`[Stellaris] Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks via Ollama`);
    }

    return results;
  }
}
