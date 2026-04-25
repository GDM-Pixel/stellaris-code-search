import { findProjectRoot } from './indexer/scanner.js';
import { runReindex } from './tools/reindex.js';
import { loadStellarisRc } from './config/stellarisrc.js';
import { scanUsage, startWatcher } from './usage/scanner.js';
import { checkIntegrity } from './indexer/integrity.js';
import { runDbSnapshot } from './db/snapshot.js';

/** Propagate .stellarisrc embedding settings into env vars if not already set. */
function applyRcToEnv(rc: Awaited<ReturnType<typeof loadStellarisRc>>): void {
  if (rc.embedding_provider && !process.env.EMBEDDING_PROVIDER) {
    process.env.EMBEDDING_PROVIDER = rc.embedding_provider;
  }
  if (rc.embedding_model && !process.env.OPENAI_EMBEDDING_MODEL && !process.env.VOYAGE_MODEL && !process.env.OLLAMA_MODEL) {
    const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
    if (provider === 'voyage') process.env.VOYAGE_MODEL = rc.embedding_model;
    else if (provider === 'ollama') process.env.OLLAMA_MODEL = rc.embedding_model;
    else process.env.OPENAI_EMBEDDING_MODEL = rc.embedding_model;
  }
  if (rc.rerank_provider && !process.env.RERANK_PROVIDER) {
    process.env.RERANK_PROVIDER = rc.rerank_provider;
  }
}

/** Check that the active embedding provider has its API key configured. */
function hasEmbeddingApiKey(): boolean {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'openai').toLowerCase();
  if (provider === 'ollama') return true; // No key needed
  if (provider === 'voyage') return !!process.env.VOYAGE_API_KEY;
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Auto-index on startup (non-blocking).
 * Only runs if .stellarisrc has auto_index=true in the project root.
 * After indexing, runs an integrity check to purge orphaned chunks.
 */
export async function autoIndex(): Promise<void> {
  try {
    const projectRoot = findProjectRoot(process.cwd());
    const rc = await loadStellarisRc(projectRoot);
    applyRcToEnv(rc);

    if (!hasEmbeddingApiKey()) {
      const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
      console.error(`[Stellaris] Skipping auto-index: no API key for provider '${provider}'`);
      // Still run integrity check even without API key — it's read-only
      try { await checkIntegrity(projectRoot); } catch { /* non-fatal */ }
      return;
    }

    if (!rc.auto_index) {
      console.error('[Stellaris] Auto-index disabled. Use the reindex tool or set auto_index=true in .stellarisrc');
      await checkIntegrity(projectRoot);
      return;
    }

    console.error(`[Stellaris] Auto-indexing project: ${projectRoot}`);

    const result = await runReindex(projectRoot);

    if (result.files_processed > 0) {
      console.error(
        `[Stellaris] Auto-index complete: ${result.files_processed} files, ${result.chunks_created} chunks`,
      );
    } else {
      console.error('[Stellaris] Auto-index: already up-to-date');
    }

    // Integrity check after reindex: purge any orphaned chunks not in meta.json
    await checkIntegrity(projectRoot);
  } catch (error: any) {
    console.error(`[Stellaris] Auto-index failed (non-fatal): ${error.message}`);
  }
}

/**
 * Auto-snapshot DB schema on startup (non-blocking).
 * Only runs if .stellarisrc has db_auto_snapshot=true, or if DB_CONNECTION_STRING / DATABASE_URL
 * env var is set. Falls back to local file parsing if no connection string is available.
 */
export async function autoDbSnapshot(): Promise<void> {
  try {
    const projectRoot = findProjectRoot(process.cwd());
    const rc = await loadStellarisRc(projectRoot);

    const hasEnvConn = !!(process.env.DB_CONNECTION_STRING || process.env.DATABASE_URL);
    const hasRcConn = !!rc.db_connection_string;

    if (!rc.db_auto_snapshot && !hasEnvConn) {
      return; // Silent — auto-snapshot not configured
    }

    console.error('[Stellaris DB] Auto-snapshotting database schema...');

    const result = await runDbSnapshot(projectRoot, {
      connectionString: rc.db_connection_string,
      provider: rc.db_provider,
      schemas: rc.db_schemas,
    });

    console.error(
      `[Stellaris DB] Auto-snapshot complete: ${result.tables} tables, ${result.enums} enums (${result.source})`,
    );
  } catch (error: any) {
    console.error(`[Stellaris DB] Auto-snapshot failed (non-fatal): ${error.message}`);
  }
}

/**
 * Scan Claude Code usage data on startup and start the file watcher.
 * Runs silently in background — no API key required, zero cost.
 */
export async function autoScanUsage(): Promise<void> {
  try {
    await scanUsage();
    startWatcher();
  } catch {
    // Silent — usage tracking is non-critical
  }
}
