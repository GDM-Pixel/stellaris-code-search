// Scan the whole project root by default. Extension filtering (SUPPORTED_EXTENSIONS),
// DEFAULT_EXCLUDE and .gitignore do the narrowing. This covers projects whose code
// lives at the root (PHP/WordPress plugins, small TS/JS repos with no src/ dir) —
// not just the src/-convention layouts previously hardcoded here.
export const DEFAULT_INCLUDE = [
  '**',
];

export const DEFAULT_EXCLUDE = [
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  'target/**',
  '**/target/**',
  '.next/**',
  '**/.next/**',
  '.nuxt/**',
  'out/**',
  'coverage/**',
  '**/coverage/**',
  // PHP / other ecosystems' dependency dirs
  'vendor/**',
  '**/vendor/**',
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
  '**/composer.lock',
  // Security: never index sensitive files
  '**/.env*',
  '**/secrets.*',
  '**/credentials.*',
  '**/*.pem',
  '**/*.key',
  '**/*.cert',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
];

export const SUPPORTED_EXTENSIONS = {
  code: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.php', '.html', '.css', '.astro', '.vue', '.svelte', '.scss', '.less', '.json', '.yaml', '.yml', '.sql', '.graphql', '.gql', '.prisma', '.toml', '.java', '.rb'],
  docs: ['.md', '.mdx'],
} as const;

export const CHUNK_CONFIG = {
  /** Max tokens per chunk (approximate) */
  maxChunkTokens: 1000,
  /** Files under this many lines are kept as a single chunk */
  smallFileThreshold: 50,
  /** Number of chunks to embed per OpenAI API call */
  embeddingBatchSize: 20,
  /** Default OpenAI model for embeddings (used when EMBEDDING_PROVIDER=openai) */
  embeddingModel: 'text-embedding-3-small' as const,
  /** Default embedding dimensions — overridden dynamically by the active provider */
  embeddingDimensions: 1536,
  /**
   * Max lines for a single AST symbol chunk.
   * Symbols longer than this are split into sub-chunks to avoid silent truncation
   * by the OpenAI embeddings API (8192 token limit).
   */
  maxSymbolLines: 300,
} as const;

/** Supported embedding providers */
export type EmbeddingProviderName = 'openai' | 'voyage' | 'ollama';

export const LANCEDB_TABLE_NAME = 'code_chunks';

export interface VectorConfig {
  include?: string[];
  exclude?: string[];
  chunkStrategy?: 'ast' | 'simple';
}
