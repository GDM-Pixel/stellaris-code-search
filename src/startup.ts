import { findProjectRoot } from './indexer/scanner.js';
import { runReindex } from './tools/reindex.js';
import { loadStellarisRc } from './config/stellarisrc.js';

/**
 * Auto-index on startup (non-blocking).
 * Only runs if .stellarisrc has auto_index=true in the project root.
 */
export async function autoIndex(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Stellaris] Skipping auto-index: OPENAI_API_KEY not set');
    return;
  }

  try {
    const projectRoot = findProjectRoot(process.cwd());
    const rc = await loadStellarisRc(projectRoot);

    if (!rc.auto_index) {
      console.error('[Stellaris] Auto-index disabled. Use the reindex tool to index this project, or set auto_index=true in .stellarisrc');
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
  } catch (error: any) {
    console.error(`[Stellaris] Auto-index failed (non-fatal): ${error.message}`);
  }
}
