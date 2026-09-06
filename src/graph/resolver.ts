/**
 * Import resolver: maps import strings to actual file paths in the project.
 * Handles relative imports, index.ts barrels, implicit extensions, and aliases.
 *
 * Alias sources, by priority (highest first):
 *   1. .stellarisrc  `alias.<name>=<path>`  (manual override / safety net)
 *   2. tsconfig/jsconfig `compilerOptions.paths` + `baseUrl`, following `extends`,
 *      discovered from the tsconfig NEAREST the source file (monorepo subdirs)
 *   3. vite.config.{ts,js,mts,cts} `resolve.alias` (object or [{find,replacement}])
 *
 * Aliases (2) and (3) are resolved relative to the directory of the config file
 * that declared them, not the indexed project root — this is what makes nested
 * apps (e.g. <repo>/nova-chat/src with its own tsconfig) resolve correctly.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import stripJsonComments from 'strip-json-comments';

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

/**
 * A single alias mapping. `prefix` is matched against the import specifier;
 * `baseDir` is the absolute directory the alias target is resolved against;
 * `targets` are the path segments to substitute (may contain several for
 * tsconfig `paths` arrays).
 */
interface AliasEntry {
  prefix: string;
  baseDir: string;
  targets: string[];
}

/** Per-project resolver state, keyed by absolute project root. */
interface ProjectResolverState {
  /** .stellarisrc alias overrides — highest priority, project-wide. */
  rcAliases: AliasEntry[];
  /** Cache of resolved alias sets per source directory. */
  dirAliasCache: Map<string, AliasEntry[]>;
}

const projectStates = new Map<string, ProjectResolverState>();

/**
 * Resolve a list of raw import strings from a source file to actual file paths.
 */
export function resolveImports(
  rawImports: string[],
  sourceFilePath: string,
  projectRoot: string,
): ResolvedImport[] {
  const state = getProjectState(projectRoot);
  const sourceDir = dirname(join(projectRoot, sourceFilePath));
  const aliases = getAliasesForDir(state, sourceDir, projectRoot);

  return rawImports
    .filter(imp => isResolvableImport(imp, aliases, sourceFilePath))
    .map(raw => ({
      raw,
      resolved: resolveImport(raw, sourceFilePath, projectRoot, aliases),
    }));
}

function getProjectState(projectRoot: string): ProjectResolverState {
  let state = projectStates.get(projectRoot);
  if (!state) {
    state = {
      rcAliases: loadRcAliases(projectRoot),
      dirAliasCache: new Map(),
    };
    projectStates.set(projectRoot, state);
  }
  return state;
}

/** QML local file import: `import "Effort.js" as Effort` (no ./). */
const QML_FILE_IMPORT = /\.(js|mjs|cjs|ts|tsx|jsx|qml)$/i;

function isQmlLocalFileImport(importStr: string): boolean {
  if (importStr.includes('://') || importStr.startsWith('qrc:')) return false;
  return QML_FILE_IMPORT.test(importStr);
}

/**
 * Check if an import is resolvable (skip node builtins; keep anything that
 * looks relative, root-absolute, or matches a known alias prefix).
 */
function isResolvableImport(
  importStr: string,
  aliases: AliasEntry[],
  sourceFilePath: string,
): boolean {
  if (importStr.startsWith('node:')) return false;
  if (importStr.startsWith('.') || importStr.startsWith('/')) return true;
  if (sourceFilePath.endsWith('.qml') && isQmlLocalFileImport(importStr)) return true;
  // Bare specifier: only resolvable if it matches an alias prefix
  return aliases.some(a => matchesAliasPrefix(importStr, a.prefix));
}

function matchesAliasPrefix(importStr: string, prefix: string): boolean {
  if (prefix === '') return false;
  // Exact alias (e.g. "@") or alias followed by a path separator.
  return importStr === prefix || importStr.startsWith(prefix + '/');
}

/**
 * Resolve a single import string to a relative file path from project root.
 */
function resolveImport(
  importStr: string,
  sourceFilePath: string,
  projectRoot: string,
  aliases: AliasEntry[],
): string | null {
  // 1. Relative imports — including QML `import "Foo.js"` (no ./)
  if (
    importStr.startsWith('.')
    || (sourceFilePath.endsWith('.qml') && isQmlLocalFileImport(importStr))
  ) {
    const sourceDir = dirname(join(projectRoot, sourceFilePath));
    const targetAbs = resolve(sourceDir, importStr);
    return tryResolveFile(targetAbs, projectRoot);
  }

  // 2. Alias resolution (.stellarisrc > tsconfig > vite — already ordered)
  for (const alias of aliases) {
    if (!matchesAliasPrefix(importStr, alias.prefix)) continue;
    const rest = importStr.slice(alias.prefix.length).replace(/^\//, '');
    for (const target of alias.targets) {
      const targetAbs = join(alias.baseDir, target, rest);
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
  let normalized = absolutePath.replace(/\\/g, '/');

  // ESM-style imports use .js extension but source files are .ts/.tsx
  // Remap: .js → .ts, .jsx → .tsx (TypeScript projects)
  if (normalized.endsWith('.js')) {
    const asTsx = normalized.slice(0, -3) + '.tsx';
    const asTs = normalized.slice(0, -3) + '.ts';
    if (existsSync(asTs)) return toRelative(asTs, projectRoot);
    if (existsSync(asTsx)) return toRelative(asTsx, projectRoot);
  } else if (normalized.endsWith('.jsx')) {
    const asTsx = normalized.slice(0, -4) + '.tsx';
    if (existsSync(asTsx)) return toRelative(asTsx, projectRoot);
  }

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

// --- Alias discovery ---------------------------------------------------------

/**
 * Build the ordered alias list applicable to a given source directory:
 * .stellarisrc overrides, then the nearest tsconfig chain, then the nearest
 * vite config. Cached per directory (within the project root subtree).
 */
function getAliasesForDir(
  state: ProjectResolverState,
  sourceDir: string,
  projectRoot: string,
): AliasEntry[] {
  const cached = state.dirAliasCache.get(sourceDir);
  if (cached) return cached;

  const tsAliases = loadNearestTsconfigAliases(sourceDir, projectRoot);
  const viteAliases = loadNearestViteAliases(sourceDir, projectRoot);

  // Last-resort convention fallback: many React/Vite projects use @/ and ~/
  // for "<src root>/". Lowest priority and only resolves if the file truly
  // exists, so it never overrides a real alias or fabricates an edge.
  const fallbackBase = nearestSrcDir(sourceDir, projectRoot);
  const conventionAliases: AliasEntry[] = [
    { prefix: '@', baseDir: fallbackBase, targets: [''] },
    { prefix: '~', baseDir: fallbackBase, targets: [''] },
  ];

  // Priority: rc (project-wide) > tsconfig (nearest) > vite (nearest) > convention
  const aliases = [...state.rcAliases, ...tsAliases, ...viteAliases, ...conventionAliases];
  state.dirAliasCache.set(sourceDir, aliases);
  return aliases;
}

/**
 * Find the `src/` directory governing a source file: the nearest ancestor that
 * contains a `src` folder (handles monorepo subdirs like <repo>/app/src),
 * falling back to <projectRoot>/src.
 */
function nearestSrcDir(startDir: string, projectRoot: string): string {
  const root = resolve(projectRoot);
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, 'src');
    if (existsSync(candidate)) return candidate;
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(projectRoot, 'src');
}

/**
 * Read `alias.<name>=<path>` lines from <projectRoot>/.stellarisrc.
 * Targets are resolved relative to the project root.
 */
function loadRcAliases(projectRoot: string): AliasEntry[] {
  const rcPath = join(projectRoot, '.stellarisrc');
  if (!existsSync(rcPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(rcPath, 'utf-8');
  } catch {
    return [];
  }
  const entries: AliasEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key.startsWith('alias.') || !value) continue;
    const prefix = key.slice('alias.'.length);
    if (!prefix) continue;
    entries.push({ prefix, baseDir: projectRoot, targets: [value] });
  }
  return entries;
}

/**
 * Walk up from `startDir` (bounded at projectRoot) to find the nearest
 * tsconfig/jsconfig and return its alias entries, following `extends`.
 */
function loadNearestTsconfigAliases(startDir: string, projectRoot: string): AliasEntry[] {
  const configNames = [
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.base.json',
    'jsconfig.json',
  ];
  const root = resolve(projectRoot);
  let dir = resolve(startDir);

  while (true) {
    for (const name of configNames) {
      const configPath = join(dir, name);
      if (existsSync(configPath)) {
        const merged = readTsconfigChain(configPath, new Set());
        if (merged && merged.paths) {
          return tsconfigToAliases(configPath, merged.baseUrl, merged.paths);
        }
        // A tsconfig with no paths still "wins" as the nearest config — stop
        // walking up so we don't pick a parent's unrelated paths.
        if (merged) return [];
      }
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

interface MergedTsconfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  /** Absolute directory baseUrl/paths should resolve against. */
  configDir: string;
}

/**
 * Read a tsconfig and merge its `extends` chain. Child values win.
 * baseUrl/paths from a parent are recorded with the parent's own directory so
 * they resolve correctly even when the child doesn't redeclare them.
 */
function readTsconfigChain(configPath: string, seen: Set<string>): MergedTsconfig | null {
  const absConfig = resolve(configPath);
  if (seen.has(absConfig)) return null;
  seen.add(absConfig);

  let config: any;
  try {
    config = JSON.parse(stripJsonComments(readFileSync(absConfig, 'utf-8')));
  } catch {
    return null;
  }

  const configDir = dirname(absConfig);
  let inherited: MergedTsconfig | null = null;

  if (typeof config.extends === 'string') {
    const ext = config.extends;
    let parentPath: string;
    if (ext.startsWith('.') || isAbsolute(ext)) {
      parentPath = resolve(configDir, ext);
    } else {
      // Package-style extends (e.g. "@tsconfig/node20/tsconfig.json").
      parentPath = resolve(configDir, 'node_modules', ext);
    }
    if (!parentPath.endsWith('.json') && !existsSync(parentPath)) {
      parentPath = parentPath + '.json';
    }
    if (existsSync(parentPath)) {
      inherited = readTsconfigChain(parentPath, seen);
    }
  }

  const co = config.compilerOptions ?? {};
  const result: MergedTsconfig = inherited
    ? { ...inherited }
    : { configDir };

  if (typeof co.baseUrl === 'string') {
    result.baseUrl = co.baseUrl;
    result.configDir = configDir;
  }
  if (co.paths && typeof co.paths === 'object') {
    // Child paths fully override inherited paths (TS semantics).
    result.paths = co.paths;
    result.configDir = configDir;
    if (result.baseUrl === undefined && inherited?.baseUrl === undefined) {
      // TS: when paths is set without baseUrl, paths are relative to the
      // tsconfig that declares them.
      result.baseUrl = '.';
    }
  }

  return result.paths || result.baseUrl ? result : (inherited ?? { configDir });
}

function tsconfigToAliases(
  configPath: string,
  baseUrl: string | undefined,
  paths: Record<string, string[]>,
): AliasEntry[] {
  const configDir = dirname(resolve(configPath));
  const baseDir = join(configDir, baseUrl ?? '.');
  const entries: AliasEntry[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const prefix = pattern.replace(/\/?\*$/, '');
    entries.push({
      prefix,
      baseDir,
      targets: targets.map(t => t.replace(/\/?\*$/, '')),
    });
  }
  // Longer prefixes first so "@/components" wins over "@".
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return entries;
}

/**
 * Walk up from `startDir` (bounded at projectRoot) to find the nearest
 * vite config and parse `resolve.alias` (object form and array form).
 */
function loadNearestViteAliases(startDir: string, projectRoot: string): AliasEntry[] {
  const names = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.cts'];
  const root = resolve(projectRoot);
  let dir = resolve(startDir);

  while (true) {
    for (const name of names) {
      const configPath = join(dir, name);
      if (existsSync(configPath)) {
        const aliases = parseViteAliases(configPath);
        if (aliases.length > 0) return aliases;
      }
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

/**
 * Best-effort static parse of vite `resolve.alias` without executing the file.
 * Handles:
 *   alias: { '@': path.resolve(__dirname, './src'), '~lib': '/abs/or/rel' }
 *   alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }]
 * Only string and `path.resolve(__dirname, '...')` replacements are understood.
 */
function parseViteAliases(configPath: string): AliasEntry[] {
  let src: string;
  try {
    src = readFileSync(configPath, 'utf-8');
  } catch {
    return [];
  }
  const configDir = dirname(resolve(configPath));

  const aliasBlockMatch = src.match(/alias\s*:\s*([\{\[])/);
  if (!aliasBlockMatch) return [];
  const startIdx = aliasBlockMatch.index! + aliasBlockMatch[0].length - 1;
  const block = extractBalanced(src, startIdx);
  if (!block) return [];

  const entries: AliasEntry[] = [];

  const resolveReplacement = (rawValue: string): { baseDir: string; target: string } | null => {
    const v = rawValue.trim();
    const pathResolve = v.match(/path\.resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (pathResolve) {
      return { baseDir: join(configDir, pathResolve[1]), target: '' };
    }
    const fileURL = v.match(/fileURLToPath\s*\(\s*new URL\(\s*['"]([^'"]+)['"]/);
    if (fileURL) {
      return { baseDir: join(configDir, fileURL[1]), target: '' };
    }
    const strLit = v.match(/^['"]([^'"]+)['"]$/);
    if (strLit) {
      const p = strLit[1];
      return { baseDir: isAbsolute(p) ? p : join(configDir, p), target: '' };
    }
    return null;
  };

  if (block.startsWith('[')) {
    // Array form: [{ find: '@', replacement: ... }, ...]
    const objRe = /\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(block)) !== null) {
      const obj = m[0];
      const find = obj.match(/find\s*:\s*['"]([^'"]+)['"]/);
      const repl = obj.match(/replacement\s*:\s*([^,}]+)/);
      if (find && repl) {
        const r = resolveReplacement(repl[1]);
        if (r) entries.push({ prefix: find[1], baseDir: r.baseDir, targets: [r.target] });
      }
    }
  } else {
    // Object form: { '@': path.resolve(__dirname, './src'), '~lib': '...' }
    // Capture the key, then the value up to the comma/brace that is NOT inside
    // parentheses (path.resolve(__dirname, './src') contains a comma).
    const keyRe = /['"]([^'"]+)['"]\s*:\s*/g;
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(block)) !== null) {
      const valStart = keyRe.lastIndex;
      let depth = 0;
      let end = valStart;
      for (; end < block.length; end++) {
        const ch = block[end];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        else if ((ch === ',' || ch === '}') && depth <= 0) break;
      }
      const r = resolveReplacement(block.slice(valStart, end));
      if (r) entries.push({ prefix: m[1], baseDir: r.baseDir, targets: [r.target] });
      keyRe.lastIndex = end;
    }
  }

  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return entries;
}

/** Extract a balanced {...} or [...] block starting at the opening bracket. */
function extractBalanced(src: string, openIdx: number): string | null {
  const open = src[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Reset cached resolver state (for testing or when project changes).
 */
export function resetResolverCache(): void {
  projectStates.clear();
}
