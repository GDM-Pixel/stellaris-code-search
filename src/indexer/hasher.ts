import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileInfo } from './scanner.js';

export interface FileMeta {
  hash: string;
  chunk_ids: string[];
  last_indexed: string;
}

export interface MetaIndex {
  [relativePath: string]: FileMeta;
}

export interface ChangedFiles {
  added: FileInfo[];
  modified: FileInfo[];
  deleted: string[]; // relative paths of removed files
}

function metaPath(projectRoot: string): string {
  return join(projectRoot, '.vectors', 'meta.json');
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

export async function loadMetaIndex(projectRoot: string): Promise<MetaIndex> {
  try {
    const raw = await readFile(metaPath(projectRoot), 'utf-8');
    return JSON.parse(raw) as MetaIndex;
  } catch {
    return {};
  }
}

export async function saveMetaIndex(projectRoot: string, meta: MetaIndex): Promise<void> {
  const dir = join(projectRoot, '.vectors');
  await mkdir(dir, { recursive: true });
  await writeFile(metaPath(projectRoot), JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Compare current files against stored meta to find changes.
 */
export async function findChangedFiles(
  projectRoot: string,
  files: FileInfo[],
): Promise<ChangedFiles> {
  const meta = await loadMetaIndex(projectRoot);
  const result: ChangedFiles = { added: [], modified: [], deleted: [] };

  const currentPaths = new Set<string>();

  for (const file of files) {
    currentPaths.add(file.relativePath);
    const hash = await computeFileHash(file.absolutePath);
    const existing = meta[file.relativePath];

    if (!existing) {
      result.added.push(file);
    } else if (existing.hash !== hash) {
      result.modified.push(file);
    }
    // else: unchanged, skip
  }

  // Find deleted files
  for (const storedPath of Object.keys(meta)) {
    if (!currentPaths.has(storedPath)) {
      result.deleted.push(storedPath);
    }
  }

  const total = result.added.length + result.modified.length + result.deleted.length;
  if (total > 0) {
    console.error(
      `[Stellaris] Changes: ${result.added.length} added, ${result.modified.length} modified, ${result.deleted.length} deleted`,
    );
  } else {
    console.error('[Stellaris] Index up-to-date, no changes detected');
  }

  return result;
}
