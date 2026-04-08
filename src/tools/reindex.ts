import { findProjectRoot, scanFiles } from '../indexer/scanner.js';
import { loadConfig } from '../config/loader.js';
import { findChangedFiles, loadMetaIndex, saveMetaIndex, computeFileHash } from '../indexer/hasher.js';
import { chunkFile, extractFileImports } from '../indexer/chunker.js';
import { embedChunks } from '../indexer/embedder.js';
import { addChunks, deleteChunksByFile } from '../store/lancedb.js';
import { addFTSChunks, deleteFTSChunksByFile } from '../store/fts.js';
import { loadStellarisRc, saveStellarisRc } from '../config/stellarisrc.js';
import { setFileEdges, deleteFileEdges } from '../graph/store.js';
import { resolveImports, resetResolverCache } from '../graph/resolver.js';
import { readFileSync } from 'node:fs';
import { relative, resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
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
    await deleteFTSChunksByFile(projectRoot, filePath);
    await deleteFileEdges(projectRoot, filePath);
    delete meta[filePath];
  }

  for (const file of changed.modified) {
    await deleteChunksByFile(projectRoot, file.relativePath);
    await deleteFTSChunksByFile(projectRoot, file.relativePath);
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

    // Store in LanceDB + FTS
    await addChunks(projectRoot, embedded);
    await addFTSChunks(projectRoot, embedded.map(c => ({
      id: c.id,
      file_path: c.file_path,
      chunk_type: c.chunk_type,
      name: c.name,
      content: c.content,
      line_start: c.line_start,
      line_end: c.line_end,
    })));

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

  // Build dependency graph for processed files
  resetResolverCache();
  let graphEdges = 0;
  for (const file of filesToProcess) {
    if (file.category !== 'code') continue;
    try {
      const content = readFileSync(file.absolutePath, 'utf-8');
      const rawImports = extractFileImports(content, file.extension);
      const resolved = resolveImports(rawImports, file.relativePath, projectRoot);
      const targets = resolved
        .filter(r => r.resolved !== null)
        .map(r => ({ targetFile: r.resolved!, importNames: [r.raw] }));
      if (targets.length > 0) {
        await setFileEdges(projectRoot, file.relativePath, targets);
        graphEdges += targets.length;
      }
    } catch {
      // Skip graph build errors for individual files
    }
  }
  if (graphEdges > 0) {
    console.error(`[Stellaris] Built dependency graph: ${graphEdges} edges from ${filesToProcess.length} files`);
  }

  return {
    files_processed: filesToProcess.length,
    chunks_created: allChunks.length,
    files_deleted: changed.deleted.length,
  };
}

/**
 * Reindex a single file by absolute path. Used by hooks after Write/Edit.
 * Skips the full project scan — only processes the one file.
 */
export async function handleReindexFile(args: Record<string, unknown>) {
  const filePath = args.file as string;

  if (!filePath || typeof filePath !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: file parameter is required (absolute path to the modified file)' }],
      isError: true,
    };
  }

  const absolutePath = resolve(filePath).replace(/\\/g, '/');

  if (!existsSync(absolutePath)) {
    // File was deleted — remove from index
    const projectRoot = findProjectRoot(absolutePath);
    const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
    await deleteChunksByFile(projectRoot, relativePath);
    await deleteFTSChunksByFile(projectRoot, relativePath);
    await deleteFileEdges(projectRoot, relativePath);
    const meta = await loadMetaIndex(projectRoot);
    delete meta[relativePath];
    await saveMetaIndex(projectRoot, meta);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: true, action: 'deleted', file: relativePath }) }],
    };
  }

  const projectRoot = findProjectRoot(absolutePath);
  const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
  const ext = extname(absolutePath);
  const category: 'code' | 'docs' = (ext === '.md' || ext === '.mdx') ? 'docs' : 'code';

  const fileInfo: FileInfo = { absolutePath, relativePath, extension: ext, category };

  // Delete old chunks + graph edges for this file
  await deleteChunksByFile(projectRoot, relativePath);
  await deleteFTSChunksByFile(projectRoot, relativePath);
  await deleteFileEdges(projectRoot, relativePath);
  const meta = await loadMetaIndex(projectRoot);
  delete meta[relativePath];

  // Re-chunk and re-embed
  let chunks;
  try {
    chunks = await chunkFile(fileInfo);
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `Error: Failed to chunk ${relativePath}: ${error.message}` }],
      isError: true,
    };
  }

  if (chunks.length === 0) {
    await saveMetaIndex(projectRoot, meta);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ success: true, file: relativePath, chunks_created: 0 }) }],
    };
  }

  const embedded = await embedChunks(chunks);
  await addChunks(projectRoot, embedded);
  await addFTSChunks(projectRoot, embedded.map(c => ({
    id: c.id,
    file_path: c.file_path,
    chunk_type: c.chunk_type,
    name: c.name,
    content: c.content,
    line_start: c.line_start,
    line_end: c.line_end,
  })));

  const hash = await computeFileHash(absolutePath);
  meta[relativePath] = {
    hash,
    chunk_ids: embedded.map(c => c.id),
    last_indexed: new Date().toISOString(),
  };
  await saveMetaIndex(projectRoot, meta);

  // Update dependency graph for this file
  if (category === 'code') {
    try {
      const content = readFileSync(absolutePath, 'utf-8');
      const rawImports = extractFileImports(content, ext);
      const resolved = resolveImports(rawImports, relativePath, projectRoot);
      const targets = resolved
        .filter(r => r.resolved !== null)
        .map(r => ({ targetFile: r.resolved!, importNames: [r.raw] }));
      if (targets.length > 0) {
        await setFileEdges(projectRoot, relativePath, targets);
      }
    } catch {
      // Skip graph errors
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ success: true, file: relativePath, chunks_created: chunks.length }),
    }],
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
