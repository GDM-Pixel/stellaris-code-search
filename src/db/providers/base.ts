import type { DbSchema } from '../types.js';

/**
 * Abstract interface that all DB provider adapters must implement.
 */
export interface DbProvider {
  /** Verify the connection works. Throws on failure. */
  testConnection(): Promise<void>;

  /** Introspect the full schema and return a normalized DbSchema. */
  introspect(schemas?: string[]): Promise<DbSchema>;

  /** Release the connection / clean up resources. */
  close(): Promise<void>;
}
