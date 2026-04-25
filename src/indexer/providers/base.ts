export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Exponential backoff retry for a single text embedding. */
export async function retryEmbed(
  fn: (text: string) => Promise<number[]>,
  text: string,
  chunkName: string,
): Promise<number[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
      return await fn(text);
    } catch (err: any) {
      if (attempt === 2) {
        console.error(`[Stellaris] Skipping chunk ${chunkName}: ${err.message}`);
      }
    }
  }
  return null;
}
