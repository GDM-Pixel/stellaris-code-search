import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { SUPPORTED_EXTENSIONS } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/loader.js';

export interface FileInfo {
  /** Absolute path */
  absolutePath: string;
  /** Relative path from project root (forward slashes) */
  relativePath: string;
  /** File extension */
  extension: string;
  /** 'code' or 'docs' */
  category: 'code' | 'docs';
}

/**
 * Find project root by walking up to find .git/
 */
export function findProjectRoot(startPath: string): string {
  let dir = resolve(startPath);
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  // Fallback: use startPath itself
  return resolve(startPath);
}

/**
 * Build an ignore filter from .gitignore + .vectorignore
 */
async function buildIgnoreFilter(projectRoot: string): Promise<Ignore> {
  const ig = ignore();

  for (const filename of ['.gitignore', '.vectorignore']) {
    const filepath = join(projectRoot, filename);
    try {
      const content = await readFile(filepath, 'utf-8');
      ig.add(content);
    } catch {
      // File doesn't exist — skip
    }
  }

  // Always ignore these
  ig.add(['node_modules', '.git', '.vectors', '.stellarisrc', 'dist']);

  // Security: never index sensitive files (defense in depth)
  ig.add(['.env*', 'secrets.*', 'credentials.*', '*.pem', '*.key', '*.cert', '*.p12', '*.pfx', '*.keystore']);

  return ig;
}

/**
 * Determine file category from extension
 */
function categorize(ext: string): 'code' | 'docs' | null {
  if ((SUPPORTED_EXTENSIONS.code as readonly string[]).includes(ext)) return 'code';
  if ((SUPPORTED_EXTENSIONS.docs as readonly string[]).includes(ext)) return 'docs';
  return null;
}

/**
 * Scan project files respecting config + .gitignore + .vectorignore
 */
export async function scanFiles(
  projectRoot: string,
  config: ResolvedConfig,
): Promise<FileInfo[]> {
  const ig = await buildIgnoreFilter(projectRoot);

  // Build glob patterns for supported extensions
  const allExtensions = [...SUPPORTED_EXTENSIONS.code, ...SUPPORTED_EXTENSIONS.docs];
  const extGlob = `**/*{${allExtensions.join(',')}}`;

  // Use fast-glob to find files matching include patterns
  const patterns = config.include.map((p) => {
    // If pattern already has extension, use as-is; otherwise append ext glob
    if (p.includes('*') && (p.includes('.ts') || p.includes('.md'))) return p;
    // Ensure pattern ends with /**
    const base = p.endsWith('/**') ? p.slice(0, -3) : p.endsWith('/') ? p.slice(0, -1) : p;
    return `${base}/${extGlob}`;
  });

  const files = await fg(patterns, {
    cwd: projectRoot,
    absolute: false,
    dot: false,
    ignore: config.exclude,
    onlyFiles: true,
    // Normalize to forward slashes
    caseSensitiveMatch: false,
  });

  const results: FileInfo[] = [];

  for (const relativePath of files) {
    // Apply .gitignore / .vectorignore filter
    if (ig.ignores(relativePath)) continue;

    const ext = '.' + relativePath.split('.').pop()!;
    const category = categorize(ext);
    if (!category) continue;

    results.push({
      absolutePath: join(projectRoot, relativePath).replace(/\\/g, '/'),
      relativePath: relativePath.replace(/\\/g, '/'),
      extension: ext,
      category,
    });
  }

  console.error(`[Stellaris] Scanned ${results.length} files (${results.filter(f => f.category === 'code').length} code, ${results.filter(f => f.category === 'docs').length} docs)`);
  return results;
}
