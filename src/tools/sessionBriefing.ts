/**
 * Tool: session_briefing
 * Condensed project state briefing for Claude Code SessionStart hook.
 * Composes: project_health summary + recently modified files (git) + blast radius hints.
 * Target: <800 tokens. Degrades gracefully if graph/git unavailable.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { detectCycles } from '../graph/cycles.js';

const execFileAsync = promisify(execFile);

interface BriefingArgs {
  days?: number;
  max_recent_files?: number;
  format?: 'markdown' | 'json';
}

async function gitRecentFiles(projectRoot: string, days: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--since=${days}.days.ago`, '--name-only', '--pretty=format:', '--diff-filter=AMR'],
      { cwd: projectRoot, timeout: 2000 },
    );
    const files = new Set<string>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed.replace(/\\/g, '/'));
    }
    return Array.from(files);
  } catch {
    return [];
  }
}

async function computeBlastRadius(projectRoot: string, file: string): Promise<number> {
  try {
    const edges = await getAllEdges(projectRoot);
    const reverseMap = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!reverseMap.has(e.target_file)) reverseMap.set(e.target_file, new Set());
      reverseMap.get(e.target_file)!.add(e.source_file);
    }
    const visited = new Set<string>();
    const queue = [file];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const parents = reverseMap.get(cur);
      if (parents) {
        for (const p of parents) if (!visited.has(p)) queue.push(p);
      }
    }
    visited.delete(file);
    return visited.size;
  } catch {
    return 0;
  }
}

export async function handleSessionBriefing(args: Record<string, unknown>) {
  const opts = args as BriefingArgs;
  const days = opts.days ?? 7;
  const maxRecent = opts.max_recent_files ?? 8;
  const format = opts.format ?? 'markdown';

  const projectRoot = findProjectRoot(process.cwd());
  const lines: string[] = [];
  const data: Record<string, unknown> = { project: projectRoot };

  // Section 1 — Graph health
  const graphReady = await hasGraph(projectRoot);
  if (graphReady) {
    try {
      const edges = await getAllEdges(projectRoot);
      const allFiles = new Set<string>();
      for (const e of edges) {
        allFiles.add(e.source_file);
        allFiles.add(e.target_file);
      }
      const cycles = detectCycles(edges);
      data.total_files = allFiles.size;
      data.total_edges = edges.length;
      data.cycles_count = cycles.length;
      const largestCycle = cycles.length > 0 ? Math.max(...cycles.map((c) => c.files.length)) : 0;
      data.largest_cycle = largestCycle;

      lines.push(`## Project Health`);
      lines.push(`- Files indexed: ${allFiles.size} · Edges: ${edges.length}`);
      lines.push(`- Circular dependencies: ${cycles.length}${cycles.length > 0 ? ` (largest: ${largestCycle} files)` : ''}`);
      if (cycles.length > 0 && cycles[0].files.length <= 4) {
        lines.push(`  - Top cycle: ${cycles[0].files.join(' → ')}`);
      }
    } catch (err) {
      lines.push(`## Project Health\n- Graph read failed: ${(err as Error).message}`);
    }
  } else {
    lines.push(`## Project Health`);
    lines.push(`- Graph not yet indexed — run \`reindex\` to enable health analysis.`);
  }

  // Section 2 — Recent activity via git
  const recent = await gitRecentFiles(projectRoot, days);
  if (recent.length > 0) {
    lines.push(``);
    lines.push(`## Recent Activity (last ${days}d)`);
    const slice = recent.slice(0, maxRecent);
    data.recent_files = slice;
    if (graphReady) {
      const withBlast: Array<{ file: string; blast: number }> = [];
      for (const f of slice) {
        const blast = await computeBlastRadius(projectRoot, f);
        withBlast.push({ file: f, blast });
      }
      withBlast.sort((a, b) => b.blast - a.blast);
      for (const { file, blast } of withBlast) {
        lines.push(`- ${file}${blast > 0 ? ` (blast radius: ${blast})` : ''}`);
      }
      data.recent_with_blast = withBlast;
    } else {
      for (const f of slice) lines.push(`- ${f}`);
    }
    if (recent.length > maxRecent) {
      lines.push(`- …and ${recent.length - maxRecent} more modified files`);
    }
  } else {
    lines.push(``);
    lines.push(`## Recent Activity`);
    lines.push(`- No git history available or no recent commits.`);
  }

  // Section 3 — Next steps hint for the hook
  lines.push(``);
  lines.push(`## Context hint`);
  lines.push(`Consider \`searchMemory\` (nova-mind-cloud) with query referencing this project for prior decisions.`);

  if (format === 'json') {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
