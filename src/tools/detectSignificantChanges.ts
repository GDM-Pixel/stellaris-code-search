/**
 * Tool: detect_significant_changes
 * Heuristic detector for "was this session technically significant enough to memorize?"
 * Uses git diff stats + graph delta.
 * Designed to be called by the SessionEnd/Stop hook — lightweight, no API.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { detectCycles } from '../graph/cycles.js';

const execFileAsync = promisify(execFile);

interface GitDiffStats {
  files_changed: number;
  insertions: number;
  deletions: number;
  files: string[];
}

async function gitDiffStats(projectRoot: string, base: string): Promise<GitDiffStats> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--shortstat', base],
      { cwd: projectRoot, timeout: 2000 },
    );
    const match = stdout.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    const filesChanged = match ? parseInt(match[1], 10) : 0;
    const insertions = match && match[2] ? parseInt(match[2], 10) : 0;
    const deletions = match && match[3] ? parseInt(match[3], 10) : 0;

    const { stdout: namesOut } = await execFileAsync(
      'git',
      ['diff', '--name-only', base],
      { cwd: projectRoot, timeout: 2000 },
    );
    const files = namesOut
      .split('\n')
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter((l) => l.length > 0);

    return { files_changed: filesChanged, insertions, deletions, files };
  } catch {
    return { files_changed: 0, insertions: 0, deletions: 0, files: [] };
  }
}

export async function handleDetectSignificantChanges(args: Record<string, unknown>) {
  const base = (args.base as string) ?? 'HEAD';
  const linesThreshold = (args.lines_threshold as number | undefined) ?? 100;
  const filesThreshold = (args.files_threshold as number | undefined) ?? 5;

  const projectRoot = findProjectRoot(process.cwd());
  const diff = await gitDiffStats(projectRoot, base);

  const totalLines = diff.insertions + diff.deletions;
  const signals: string[] = [];
  let significant = false;

  if (totalLines >= linesThreshold) {
    signals.push(`${totalLines} lines modified (threshold: ${linesThreshold})`);
    significant = true;
  }
  if (diff.files_changed >= filesThreshold) {
    signals.push(`${diff.files_changed} files touched (threshold: ${filesThreshold})`);
    significant = true;
  }

  let cyclesCount = 0;
  if (await hasGraph(projectRoot)) {
    try {
      const edges = await getAllEdges(projectRoot);
      const cycles = detectCycles(edges);
      cyclesCount = cycles.length;
      if (cycles.length > 0) {
        signals.push(`graph has ${cycles.length} circular dependencies — refactor candidate`);
      }
    } catch {
      /* ignore */
    }
  }

  const response = {
    significant,
    signals,
    stats: {
      files_changed: diff.files_changed,
      lines_changed: totalLines,
      insertions: diff.insertions,
      deletions: diff.deletions,
      touched_files: diff.files.slice(0, 10),
      cycles_count: cyclesCount,
    },
    recommendation: significant
      ? 'Call nova-mind-cloud storeMemory with category="technical.development" and a concise summary of what was decided, refactored, or fixed.'
      : 'No significant technical changes detected — skip memorization.',
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
}
