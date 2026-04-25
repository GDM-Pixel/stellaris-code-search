import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileInfo } from './scanner.js';

export interface FileMeta {
  hash: string;
  chunk_ids: string[];
  last_indexed: string;
}

export interface IndexConfig {
  provider: string;
  model: string;
  dims: number;
}

export interface MetaIndex {
  [relativePath: string]: FileMeta;
}

interface RawMetaFile {
  _index_config?: IndexConfig;
  [relativePath: string]: FileMeta | IndexConfig | undefined;
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
    const parsed = JSON.parse(raw) as RawMetaFile;
    // Strip the _index_config sentinel — callers work only with FileMeta entries
    const { _index_config: _, ...fileMeta } = parsed;
    return fileMeta as MetaIndex;
  } catch {
    return {};
  }
}

async function loadRawMeta(projectRoot: string): Promise<RawMetaFile> {
  try {
    const raw = await readFile(metaPath(projectRoot), 'utf-8');
    return JSON.parse(raw) as RawMetaFile;
  } catch {
    return {};
  }
}

export async function saveMetaIndex(projectRoot: string, meta: MetaIndex): Promise<void> {
  const dir = join(projectRoot, '.vectors');
  await mkdir(dir, { recursive: true });

  // Preserve _index_config if it exists
  const existing = await loadRawMeta(projectRoot);
  const toWrite: RawMetaFile = { ...meta };
  if (existing._index_config) toWrite._index_config = existing._index_config;

  // Atomic write: write to .tmp then rename to avoid corrupt meta.json on crash mid-write
  const target = metaPath(projectRoot);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(toWrite, null, 2), 'utf-8');
  await rename(tmp, target);
}

/**
 * Read the stored embedding config from meta.json, or null if not set.
 */
export async function getStoredIndexConfig(projectRoot: string): Promise<IndexConfig | null> {
  const raw = await loadRawMeta(projectRoot);
  const cfg = raw._index_config;
  if (cfg && typeof cfg.provider === 'string') return cfg;
  return null;
}

/**
 * Persist the current embedding config into meta.json (preserves file entries).
 */
export async function saveIndexConfig(projectRoot: string, config: IndexConfig): Promise<void> {
  const dir = join(projectRoot, '.vectors');
  await mkdir(dir, { recursive: true });

  const existing = await loadRawMeta(projectRoot);
  const toWrite: RawMetaFile = { ...existing, _index_config: config };

  const target = metaPath(projectRoot);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(toWrite, null, 2), 'utf-8');
  await rename(tmp, target);
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
