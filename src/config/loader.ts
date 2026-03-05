import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_INCLUDE, DEFAULT_EXCLUDE, type VectorConfig } from './defaults.js';

export interface ResolvedConfig {
  include: string[];
  exclude: string[];
  chunkStrategy: 'ast' | 'simple';
}

export async function loadConfig(projectRoot: string): Promise<ResolvedConfig> {
  const configPath = join(projectRoot, '.vectorconfig.json');

  let userConfig: VectorConfig = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    userConfig = JSON.parse(raw) as VectorConfig;
  } catch {
    // No config file — use defaults
  }

  return {
    include: userConfig.include ?? DEFAULT_INCLUDE,
    exclude: userConfig.exclude ?? DEFAULT_EXCLUDE,
    chunkStrategy: userConfig.chunkStrategy ?? 'ast',
  };
}
