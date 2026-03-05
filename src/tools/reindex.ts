import { findProjectRoot, scanFiles } from '../indexer/scanner.js';
import { loadConfig } from '../config/loader.js';
import { findChangedFiles, loadMetaIndex, saveMetaIndex, computeFileHash } from '../indexer/hasher.js';
import { chunkFile } from '../indexer/chunker.js';
import { embedChunks } from '../indexer/embedder.js';
import { addChunks, deleteChunksByFile } from '../store/lancedb.js';
import { loadStellarisRc, saveStellarisRc } from '../config/stellarisrc.js';
import type { FileInfo } from '../indexer/scanner.js';

export async function runReindex(projectRoot: string): Promise<{
  files_processed: number;
  chunks_created: number;
  files_deleted: number;
}> {
  const config = await loadConfig(projectRoot);
  const files = await scanFiles(projectRoot, config);
  const changed = await findChangedFiles(projectRoot, files);

  const totalChanges = changed.added.length + changed.modified.length + changed.deleted.length;
  if (totalChanges === 0) {
    return { files_processed: 0, chunks_created: 0, files_deleted: 0 };
  }

  // Delete old chunks for modified and deleted files
  const meta = await loadMetaIndex(projectRoot);

  for (const filePath of changed.deleted) {
    await deleteChunksByFile(projectRoot, filePath);
    delete meta[filePath];
  }

  for (const file of changed.modified) {
    await deleteChunksByFile(projectRoot, file.relativePath);
    delete meta[file.relativePath];
  }

  // Chunk new + modified files
  const filesToProcess: FileInfo[] = [...changed.added, ...changed.modified];
  const allChunks = [];

  for (const file of filesToProcess) {
    try {
      const chunks = await chunkFile(file);
      allChunks.push(...chunks);
    } catch (error: any) {
      console.error(`[Stellaris] Failed to chunk ${file.relativePath}: ${error.message}`);
    }
  }

  // Embed all chunks
  let embedded;
  if (allChunks.length > 0) {
    console.error(`[Stellaris] Embedding ${allChunks.length} chunks from ${filesToProcess.length} files...`);
    embedded = await embedChunks(allChunks);

    // Store in LanceDB
    await addChunks(projectRoot, embedded);

    // Update meta index
    for (const chunk of embedded) {
      if (!meta[chunk.file_path]) {
        const file = filesToProcess.find((f) => f.relativePath === chunk.file_path);
        const hash = file ? await computeFileHash(file.absolutePath) : '';
        meta[chunk.file_path] = {
          hash,
          chunk_ids: [],
          last_indexed: new Date().toISOString(),
        };
      }
      meta[chunk.file_path].chunk_ids.push(chunk.id);
    }
  }

  await saveMetaIndex(projectRoot, meta);

  return {
    files_processed: filesToProcess.length,
    chunks_created: allChunks.length,
    files_deleted: changed.deleted.length,
  };
}

export async function handleReindex(args: Record<string, unknown>) {
  const path = args.path as string | undefined;
  const enableAutoIndex = args.enable_auto_index as boolean | undefined;
  const projectRoot = path ?? findProjectRoot(process.cwd());

  // Handle auto_index toggle
  if (enableAutoIndex !== undefined) {
    const rc = await loadStellarisRc(projectRoot);
    rc.auto_index = enableAutoIndex;
    await saveStellarisRc(projectRoot, rc);
    console.error(`[Stellaris] auto_index set to ${enableAutoIndex} in .stellarisrc`);
  }

  console.error(`[Stellaris] Reindexing ${projectRoot}...`);
  const result = await runReindex(projectRoot);

  // After first successful indexation, create .stellarisrc with auto_index=true
  if (result.files_processed > 0 && enableAutoIndex === undefined) {
    const rc = await loadStellarisRc(projectRoot);
    if (!rc.auto_index) {
      rc.auto_index = true;
      await saveStellarisRc(projectRoot, rc);
      console.error('[Stellaris] Created .stellarisrc with auto_index=true');
    }
  }

  const rc = await loadStellarisRc(projectRoot);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: true,
        project: projectRoot,
        ...result,
        auto_index: rc.auto_index,
        message: result.files_processed === 0
          ? 'Index already up-to-date, no changes detected'
          : `Reindexed ${result.files_processed} files, created ${result.chunks_created} chunks. Auto-index enabled for next startup.`,
      }, null, 2),
    }],
  };
}
