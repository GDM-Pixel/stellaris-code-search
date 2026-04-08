/**
 * Import resolver: maps import strings to actual file paths in the project.
 * Handles relative imports, index.ts barrels, implicit extensions, and TS path aliases.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

/**
 * Supported extensions to try when resolving imports without explicit extension.
 */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Index files to try when resolving a directory import.
 */
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => `index${ext}`);

export interface ResolvedImport {
  /** Raw import string as found in source (e.g., "./utils/auth") */
  raw: string;
  /** Resolved relative path from project root (e.g., "src/utils/auth.ts"), or null if unresolved */
  resolved: string | null;
}

let tsPaths: Record<string, string[]> | null = null;
let tsBaseUrl: string | null = null;
let tsPathsLoaded = false;

/**
 * Resolve a list of raw import strings from a source file to actual file paths.
 */
export function resolveImports(
  rawImports: string[],
  sourceFilePath: string,
  projectRoot: string,
): ResolvedImport[] {
  if (!tsPathsLoaded) {
    loadTSPaths(projectRoot);
  }

  return rawImports
    .filter(imp => isResolvableImport(imp))
    .map(raw => ({
      raw,
      resolved: resolveImport(raw, sourceFilePath, projectRoot),
    }));
}

/**
 * Check if an import is resolvable (skip node_modules, builtins, etc.)
 */
function isResolvableImport(importStr: string): boolean {
  // Skip node builtins
  if (importStr.startsWith('node:')) return false;
  // Skip bare specifiers (npm packages) unless they match TS path aliases
  if (!importStr.startsWith('.') && !importStr.startsWith('/') && !importStr.startsWith('@/') && !importStr.startsWith('~')) {
    // Could be a TS path alias — check later
    if (tsPaths && Object.keys(tsPaths).some(p => importStr.startsWith(p.replace('/*', '')))) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Resolve a single import string to a relative file path from project root.
 */
function resolveImport(
  importStr: string,
  sourceFilePath: string,
  projectRoot: string,
): string | null {
  // 1. Try TS path aliases first
  const aliasResolved = tryResolveAlias(importStr, projectRoot);
  if (aliasResolved) return aliasResolved;

  // 2. Resolve relative imports
  if (importStr.startsWith('.')) {
    const sourceDir = dirname(join(projectRoot, sourceFilePath));
    const targetAbs = resolve(sourceDir, importStr);
    return tryResolveFile(targetAbs, projectRoot);
  }

  // 3. Absolute imports starting with @/ or ~/
  if (importStr.startsWith('@/') || importStr.startsWith('~/')) {
    const stripped = importStr.slice(2);
    const targetAbs = join(projectRoot, 'src', stripped);
    return tryResolveFile(targetAbs, projectRoot);
  }

  return null;
}

/**
 * Try to resolve a TS path alias.
 */
function tryResolveAlias(importStr: string, projectRoot: string): string | null {
  if (!tsPaths || !tsBaseUrl) return null;

  for (const [pattern, targets] of Object.entries(tsPaths)) {
    const prefix = pattern.replace('/*', '');
    if (!importStr.startsWith(prefix)) continue;

    const rest = importStr.slice(prefix.length).replace(/^\//, '');

    for (const target of targets) {
      const targetBase = target.replace('/*', '');
      const targetAbs = join(projectRoot, tsBaseUrl, targetBase, rest);
      const resolved = tryResolveFile(targetAbs, projectRoot);
      if (resolved) return resolved;
    }
  }

  return null;
}

/**
 * Try to resolve an absolute path to an existing file.
 * Tries: exact path, with extensions, as directory (index file).
 */
function tryResolveFile(absolutePath: string, projectRoot: string): string | null {
  // Normalize path separators
  const normalized = absolutePath.replace(/\\/g, '/');

  // 1. Exact match (path already has extension)
  if (existsSync(normalized)) {
    const stat = statSync(normalized);
    if (stat.isFile()) {
      return toRelative(normalized, projectRoot);
    }
    // It's a directory — try index files
    if (stat.isDirectory()) {
      for (const idx of INDEX_FILES) {
        const indexPath = join(normalized, idx);
        if (existsSync(indexPath)) {
          return toRelative(indexPath, projectRoot);
        }
      }
    }
  }

  // 2. Try adding extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = normalized + ext;
    if (existsSync(withExt)) {
      return toRelative(withExt, projectRoot);
    }
  }

  // 3. Try as directory with index files
  for (const idx of INDEX_FILES) {
    const indexPath = join(normalized, idx);
    if (existsSync(indexPath)) {
      return toRelative(indexPath, projectRoot);
    }
  }

  return null;
}

function toRelative(absolutePath: string, projectRoot: string): string {
  return relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

/**
 * Load tsconfig.json paths for alias resolution.
 */
function loadTSPaths(projectRoot: string): void {
  tsPathsLoaded = true;

  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];

  for (const file of candidates) {
    const configPath = join(projectRoot, file);
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, 'utf-8');
      // Strip comments (simple approach for JSON with comments)
      const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(cleaned);

      if (config.compilerOptions?.paths) {
        tsPaths = config.compilerOptions.paths;
        tsBaseUrl = config.compilerOptions.baseUrl ?? '.';
        return;
      }
    } catch {
      // Skip invalid tsconfig
    }
  }
}

/**
 * Reset cached TS paths (for testing or when project changes).
 */
export function resetResolverCache(): void {
  tsPaths = null;
  tsBaseUrl = null;
  tsPathsLoaded = false;
}
