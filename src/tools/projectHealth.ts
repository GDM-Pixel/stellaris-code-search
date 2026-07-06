/**
 * Tool: project_health
 * Aggregated health check using graph analysis tools.
 * Reports: cycles, dead code, coupling hotspots, graph complexity, depth, index freshness.
 * Returns a global score A–F.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { noGraphError } from '../config/projectRoot.js';
import { getAllEdges, hasGraph } from '../graph/store.js';
import { loadMetaIndex } from '../indexer/hasher.js';
import { detectCycles } from '../graph/cycles.js';
import { NON_IMPORTABLE_EXTENSIONS, isEntryPoint } from './getDeadCode.js';

interface HealthResult {
  score: string;
  grade_details: string;
  summary: string;
  stats: {
    total_files: number;
    total_edges: number;
    density: number;
    avg_degree: number;
  };
  cycles: {
    count: number;
    total_files_in_cycles: number;
    largest_cycle: number;
    files?: string[];
  };
  dead_code: {
    count: number;
    percent: number;
    files: string[];
  };
  hotspots: Array<{
    path: string;
    in_degree: number;
    out_degree: number;
    total: number;
  }>;
  max_depth: number;
  index_age_hours: number | null;
}

function computeDeadCode(
  allFiles: string[],
  inDegree: Map<string, number>,
): string[] {
  return allFiles.filter(f => {
    const deg = inDegree.get(f) ?? 0;
    if (deg > 0) return false;
    const ext = f.substring(f.lastIndexOf('.'));
    if (NON_IMPORTABLE_EXTENSIONS.has(ext)) return false;
    return !isEntryPoint(f);
  });
}

function computeMaxDepth(
  allFiles: string[],
  adjList: Map<string, string[]>,
  inDegree: Map<string, number>,
): number {
  // Longest path in a DAG via Kahn's topological sort — O(V+E).
  // Nodes in cycles are skipped (their in-degree never reaches 0).
  const importableFiles = allFiles.filter(f => {
    const ext = f.substring(f.lastIndexOf('.'));
    return !NON_IMPORTABLE_EXTENSIONS.has(ext);
  });

  // Work on a local copy of in-degrees so we don't mutate the caller's map.
  const deg = new Map<string, number>();
  for (const f of importableFiles) deg.set(f, inDegree.get(f) ?? 0);

  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const f of importableFiles) {
    if (deg.get(f) === 0) {
      dist.set(f, 0);
      queue.push(f);
    }
  }

  let maxDepth = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    const d = dist.get(node)!;
    for (const n of (adjList.get(node) ?? [])) {
      if (!deg.has(n)) continue; // non-importable neighbor
      const nd = d + 1;
      if (nd > (dist.get(n) ?? -1)) dist.set(n, nd);
      if (nd > maxDepth) maxDepth = nd;
      const remaining = deg.get(n)! - 1;
      deg.set(n, remaining);
      if (remaining === 0) queue.push(n);
    }
  }
  return maxDepth;
}

function computeScore(
  cycleCount: number,
  deadCodePercent: number,
  density: number,
  maxDepth: number,
  totalFiles: number,
): { score: string; details: string } {
  let points = 100;
  const reasons: string[] = [];

  // Cycles penalty: -15 per cycle, max -40
  if (cycleCount > 0) {
    const penalty = Math.min(40, cycleCount * 15);
    points -= penalty;
    reasons.push(`-${penalty}pts: ${cycleCount} circular dependency group(s)`);
  }

  // Dead code penalty: -1 per %, max -25
  if (deadCodePercent > 3) {
    const penalty = Math.min(25, Math.round(deadCodePercent));
    points -= penalty;
    reasons.push(`-${penalty}pts: ${deadCodePercent.toFixed(1)}% dead code`);
  }

  // Density penalty: if > 3 edges/file, something's unusual
  if (density > 3) {
    const penalty = Math.min(15, Math.round((density - 3) * 5));
    points -= penalty;
    reasons.push(`-${penalty}pts: high density (${density.toFixed(1)} edges/file)`);
  }

  // Depth penalty: deep chains > 10 layers
  if (maxDepth > 10) {
    const penalty = Math.min(10, maxDepth - 10);
    points -= penalty;
    reasons.push(`-${penalty}pts: deep import chain (${maxDepth} levels)`);
  }

  points = Math.max(0, Math.min(100, points));

  let grade: string;
  if (points >= 90) grade = 'A';
  else if (points >= 75) grade = 'B';
  else if (points >= 60) grade = 'C';
  else if (points >= 40) grade = 'D';
  else grade = 'F';

  if (reasons.length === 0) reasons.push('No issues detected');

  return {
    score: `${grade} (${points}/100)`,
    details: reasons.join('; '),
  };
}

export async function handleProjectHealth(_args: Record<string, unknown>) {
  const projectRoot = findProjectRoot(process.cwd());

  if (!(await hasGraph(projectRoot))) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(noGraphError(projectRoot), null, 2),
      }],
      isError: true,
    };
  }

  const [edges, meta] = await Promise.all([
    getAllEdges(projectRoot),
    loadMetaIndex(projectRoot),
  ]);

  const allFiles = Object.keys(meta);

  // Compute degrees
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const e of edges) {
    inDegree.set(e.target_file, (inDegree.get(e.target_file) ?? 0) + 1);
    outDegree.set(e.source_file, (outDegree.get(e.source_file) ?? 0) + 1);
    if (!adjList.has(e.source_file)) adjList.set(e.source_file, []);
    adjList.get(e.source_file)!.push(e.target_file);
  }

  // 1. Cycles
  const cycles = detectCycles(edges);
  const cycleFiles = new Set<string>();
  for (const c of cycles) c.files.forEach(f => cycleFiles.add(f));
  const largestCycle = cycles.reduce((max, c) => Math.max(max, c.files.length), 0);

  // 2. Dead code
  const deadFiles = computeDeadCode(allFiles, inDegree);
  const importableCount = allFiles.filter(f => {
    const ext = f.substring(f.lastIndexOf('.'));
    return !NON_IMPORTABLE_EXTENSIONS.has(ext);
  }).length;
  const deadCodePercent = importableCount > 0 ? (deadFiles.length / importableCount) * 100 : 0;

  // 3. Coupling hotspots (top 10)
  const nodeSet = new Set<string>();
  for (const e of edges) { nodeSet.add(e.source_file); nodeSet.add(e.target_file); }
  const hotspots = Array.from(nodeSet)
    .map(f => ({
      path: f,
      in_degree: inDegree.get(f) ?? 0,
      out_degree: outDegree.get(f) ?? 0,
      total: (inDegree.get(f) ?? 0) + (outDegree.get(f) ?? 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // 4. Graph stats
  const totalEdges = edges.length;
  const density = allFiles.length > 0 ? totalEdges / allFiles.length : 0;
  const totalDegree = Array.from(nodeSet).reduce((sum, f) =>
    sum + (inDegree.get(f) ?? 0) + (outDegree.get(f) ?? 0), 0);
  const avgDegree = nodeSet.size > 0 ? totalDegree / nodeSet.size : 0;

  // 5. Max import depth
  const maxDepth = computeMaxDepth(allFiles, adjList, inDegree);

  // 6. Index freshness
  let indexAgeHours: number | null = null;
  try {
    const metaPath = join(projectRoot, '.vectors', 'meta.json');
    const s = await stat(metaPath);
    indexAgeHours = Math.round((Date.now() - s.mtimeMs) / 3600000 * 10) / 10;
  } catch { /* no meta.json */ }

  // 7. Score
  const { score, details } = computeScore(
    cycles.length, deadCodePercent, density, maxDepth, allFiles.length,
  );

  const result: HealthResult = {
    score,
    grade_details: details,
    summary: `Project health: ${score}. ${allFiles.length} files, ${totalEdges} edges, ${cycles.length} cycle(s), ${deadFiles.length} dead file(s), max depth ${maxDepth}.`,
    stats: {
      total_files: allFiles.length,
      total_edges: totalEdges,
      density: Math.round(density * 100) / 100,
      avg_degree: Math.round(avgDegree * 100) / 100,
    },
    cycles: {
      count: cycles.length,
      total_files_in_cycles: cycleFiles.size,
      largest_cycle: largestCycle,
      ...(cycleFiles.size > 0 && cycleFiles.size <= 30 ? { files: Array.from(cycleFiles).sort() } : {}),
    },
    dead_code: {
      count: deadFiles.length,
      percent: Math.round(deadCodePercent * 10) / 10,
      files: deadFiles.slice(0, 30),
    },
    hotspots,
    max_depth: maxDepth,
    index_age_hours: indexAgeHours,
  };

  // Next steps hint
  const hints: string[] = [];
  if (cycles.length > 0) hints.push('Run get_circular_deps for detailed cycle analysis.');
  if (deadFiles.length > 0) hints.push('Run get_dead_code for full unreferenced files list.');
  if (hotspots.length > 0 && hotspots[0].total > 15) hints.push('Run get_most_coupled to investigate coupling hotspots.');
  if (indexAgeHours !== null && indexAgeHours > 24) hints.push('Index is stale — run reindex to refresh.');

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        ...result,
        next_steps: hints,
      }, null, 2),
    }],
  };
}
