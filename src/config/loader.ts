import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DEFAULT_INCLUDE, DEFAULT_EXCLUDE, type VectorConfig } from './defaults.js';

export interface ResolvedConfig {
  include: string[];
  exclude: string[];
  chunkStrategy: 'ast' | 'simple';
}

const SUBPROJECT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'composer.json',
];

const SUBPROJECT_SOURCE_DIRS = ['src', 'src-tauri/src', 'app', 'lib'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vectors',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  'out',
  'coverage',
]);

/**
 * Detect subprojects nested in the repo root by looking for project markers
 * (package.json, Cargo.toml, etc.) at the first level. For each one found,
 * return glob patterns covering its source directories.
 *
 * Skips conventional monorepo containers (apps/, packages/) which are already
 * covered by DEFAULT_INCLUDE.
 */
async function detectSubprojectIncludes(projectRoot: string): Promise<string[]> {
  const patterns: string[] = [];
  let entries;
  try {
    entries = await readdir(projectRoot, { withFileTypes: true });
  } catch {
    return patterns;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    // Skip monorepo containers already in DEFAULT_INCLUDE
    if (['apps', 'packages', 'src', 'supabase', 'docs'].includes(entry.name)) continue;

    const subDir = join(projectRoot, entry.name);
    const hasMarker = SUBPROJECT_MARKERS.some((m) => existsSync(join(subDir, m)));
    if (!hasMarker) continue;

    for (const srcDir of SUBPROJECT_SOURCE_DIRS) {
      if (existsSync(join(subDir, srcDir))) {
        patterns.push(`${entry.name}/${srcDir}/**`);
      }
    }
  }

  return patterns;
}

export async function loadConfig(projectRoot: string): Promise<ResolvedConfig> {
  const configPath = join(projectRoot, '.vectorconfig.json');

  let userConfig: VectorConfig = {};
  let userConfigExists = false;
  try {
    const raw = await readFile(configPath, 'utf-8');
    userConfig = JSON.parse(raw) as VectorConfig;
    userConfigExists = true;
  } catch {
    // No config file — use defaults
  }

  // If user provided their own include, respect it verbatim.
  // Otherwise, augment DEFAULT_INCLUDE with auto-detected subprojects.
  let include: string[];
  if (userConfigExists && userConfig.include) {
    include = userConfig.include;
  } else {
    const subprojectPatterns = await detectSubprojectIncludes(projectRoot);
    include = [...DEFAULT_INCLUDE, ...subprojectPatterns];
    if (subprojectPatterns.length > 0) {
      console.error(`[Stellaris] Auto-detected subproject includes: ${subprojectPatterns.join(', ')}`);
    }
  }

  return {
    include,
    exclude: userConfig.exclude ?? DEFAULT_EXCLUDE,
    chunkStrategy: userConfig.chunkStrategy ?? 'ast',
  };
}
