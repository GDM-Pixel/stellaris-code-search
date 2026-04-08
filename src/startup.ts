import { findProjectRoot } from './indexer/scanner.js';
import { runReindex } from './tools/reindex.js';
import { loadStellarisRc } from './config/stellarisrc.js';
import { scanUsage, startWatcher } from './usage/scanner.js';
import { checkIntegrity } from './indexer/integrity.js';

/**
 * Auto-index on startup (non-blocking).
 * Only runs if .stellarisrc has auto_index=true in the project root.
 * After indexing, runs an integrity check to purge orphaned chunks.
 */
export async function autoIndex(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Stellaris] Skipping auto-index: OPENAI_API_KEY not set');
    // Still run integrity check even without API key — it's read-only
    try {
      const projectRoot = findProjectRoot(process.cwd());
      await checkIntegrity(projectRoot);
    } catch {
      // Non-fatal
    }
    return;
  }

  try {
    const projectRoot = findProjectRoot(process.cwd());
    const rc = await loadStellarisRc(projectRoot);

    if (!rc.auto_index) {
      console.error('[Stellaris] Auto-index disabled. Use the reindex tool to index this project, or set auto_index=true in .stellarisrc');
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
