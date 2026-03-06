export const DEFAULT_INCLUDE = [
  'src/**',
  'packages/**',
  'supabase/**',
  'docs/**',
  'apps/**',
  'cerebro-batch/src/**',
];

export const DEFAULT_EXCLUDE = [
  'node_modules/**',
  'dist/**',
  '.git/**',
  '.vectors/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.d.ts',
  '**/*.generated.ts',
  '**/database.types.ts',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
];

export const SUPPORTED_EXTENSIONS = {
  code: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.php', '.html', '.css', '.astro', '.vue', '.svelte', '.scss', '.less', '.json', '.yaml', '.yml', '.sql', '.graphql', '.gql', '.prisma', '.toml'],
  docs: ['.md', '.mdx'],
} as const;

export const CHUNK_CONFIG = {
  /** Max tokens per chunk (approximate) */
  maxChunkTokens: 1000,
  /** Files under this many lines are kept as a single chunk */
  smallFileThreshold: 50,
  /** Number of chunks to embed per OpenAI API call */
  embeddingBatchSize: 20,
  /** OpenAI model for embeddings */
  embeddingModel: 'text-embedding-3-small' as const,
  /** Embedding dimensions */
  embeddingDimensions: 1536,
} as const;

export const LANCEDB_TABLE_NAME = 'code_chunks';

export interface VectorConfig {
  include?: string[];
  exclude?: string[];
  chunkStrategy?: 'ast' | 'simple';
}
