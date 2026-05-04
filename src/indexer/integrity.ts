/**
 * Index integrity checker.
 *
 * Detects and purges orphaned chunks in LanceDB + FTS that have no corresponding
 * entry in meta.json. This handles cases where:
 *   - meta.json was corrupted or deleted
 *   - A crash occurred between deleteChunks and saveMetaIndex
 *   - Manual edits to .vectors/ left the stores inconsistent
 *
 * Also detects meta entries pointing to files that no longer exist on disk,
 * and cleans them up so the next reindex starts from a clean state.
 *
 * Runs non-blocking at startup, after autoIndex.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadMetaIndex, saveMetaIndex } from './hasher.js';
import { deleteChunksByFile } from '../store/lancedb.js';
import { deleteFTSChunksByFile, getIndexedFilePaths } from '../store/fts.js';
import { deleteFileEdges } from '../graph/store.js';

export interface IntegrityReport {
  orphaned_purged: string[];   // FTS paths purged (no meta entry)
  stale_meta_removed: string[]; // meta paths removed (file deleted from disk)
  skipped: boolean;             // true if no index exists yet
}

/**
 * Run integrity check for the given project root.
 * Safe to call at startup — read-only unless it finds problems.
 */
export async function checkIntegrity(projectRoot: string): Promise<IntegrityReport> {
  const report: IntegrityReport = {
    orphaned_purged: [],
    stale_meta_removed: [],
    skipped: false,
  };

  const ftsDbPath = join(projectRoot, '.vectors', 'fts.db');
  const metaPath = join(projectRoot, '.vectors', 'meta.json');

  // Nothing to check if index doesn't exist yet
  if (!existsSync(ftsDbPath) || !existsSync(metaPath)) {
    report.skipped = true;
    return report;
  }

  const [meta, indexedPaths] = await Promise.all([
    loadMetaIndex(projectRoot),
    getIndexedFilePaths(projectRoot),
  ]);

  const metaPaths = new Set(Object.keys(meta));

  // 1. Orphaned chunks: in FTS index but NOT in meta.json
  //    These are leftover from a previous incomplete reindex or corruption.
  const orphaned = [...indexedPaths].filter(p => !metaPaths.has(p));
  if (orphaned.length > 0) {
    console.error(`[Stellaris] Integrity: found ${orphaned.length} orphaned file(s) in index — purging`);
    for (const filePath of orphaned) {
      try {
        await deleteChunksByFile(projectRoot, filePath);
        await deleteFTSChunksByFile(projectRoot, filePath);
        await deleteFileEdges(projectRoot, filePath);
        report.orphaned_purged.push(filePath);
      } catch (err: any) {
        console.error(`[Stellaris] Integrity: failed to purge ${filePath}: ${err.message}`);
      }
    }
  }

  // 2. Stale meta entries: in meta.json but file no longer exists on disk.
  //    Remove them so the hasher doesn't consider them as "unchanged".
  //    They'll be re-added if the file is restored.
  let metaChanged = false;
  for (const relativePath of metaPaths) {
    const absolutePath = join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      delete meta[relativePath];
      report.stale_meta_removed.push(relativePath);
      metaChanged = true;
    }
  }

  if (metaChanged) {
    console.error(`[Stellaris] Integrity: removed ${report.stale_meta_removed.length} stale meta entry(ies) for deleted files`);
    await saveMetaIndex(projectRoot, meta);
  }

  const totalIssues = report.orphaned_purged.length + report.stale_meta_removed.length;
  if (totalIssues === 0) {
    console.error('[Stellaris] Integrity check passed — index is consistent');
  }

  return report;
}
