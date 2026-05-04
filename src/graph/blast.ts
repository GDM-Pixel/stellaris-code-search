/**
 * Blast radius analysis: BFS traversal of the dependency graph.
 * Given a file, finds all files that would be impacted by changes to it.
 */

import { getDependents, getDependencies, type FileNode } from './store.js';

export interface BlastRadiusResult {
  /** The file being analyzed */
  source_file: string;
  /** Files directly or transitively affected, with their depth from source */
  impacted_files: FileNode[];
  /** Total number of impacted files */
  impacted_count: number;
  /** BFS depth used */
  max_depth: number;
  /** Edges traversed during BFS */
  edges: { from: string; to: string; depth: number }[];
}

/**
 * Compute blast radius: BFS from a file through its dependents (reverse edges).
 * "If I change file X, what else could break?"
 */
export async function computeBlastRadius(
  projectRoot: string,
  filePath: string,
  maxDepth: number = 2,
): Promise<BlastRadiusResult> {
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file: filePath, depth: 0 }];
  const impactedFiles: FileNode[] = [];
  const edges: BlastRadiusResult['edges'] = [];

  visited.add(filePath);

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    // Get files that depend on this file (reverse edges)
    const dependents = await getDependents(projectRoot, file);

    for (const edge of dependents) {
      if (visited.has(edge.source_file)) continue;

      visited.add(edge.source_file);
      const nextDepth = depth + 1;

      impactedFiles.push({
        file_path: edge.source_file,
        depth: nextDepth,
      });

      edges.push({
        from: file,
        to: edge.source_file,
        depth: nextDepth,
      });

      if (nextDepth < maxDepth) {
        queue.push({ file: edge.source_file, depth: nextDepth });
      }
    }
  }

  // Sort by depth then alphabetically
  impactedFiles.sort((a, b) => a.depth - b.depth || a.file_path.localeCompare(b.file_path));

  return {
    source_file: filePath,
    impacted_files: impactedFiles,
    impacted_count: impactedFiles.length,
    max_depth: maxDepth,
    edges,
  };
}

/**
 * Get the full dependency chain for a file (forward edges).
 * "What does file X depend on?"
 */
export async function computeDependencyChain(
  projectRoot: string,
  filePath: string,
  maxDepth: number = 2,
): Promise<{
  source_file: string;
  dependencies: FileNode[];
  dependency_count: number;
  max_depth: number;
}> {
  const visited = new Set<string>();
  const queue: { file: string; depth: number }[] = [{ file: filePath, depth: 0 }];
  const dependencies: FileNode[] = [];

  visited.add(filePath);

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    const deps = await getDependencies(projectRoot, file);

    for (const edge of deps) {
      if (visited.has(edge.target_file)) continue;

      visited.add(edge.target_file);
      const nextDepth = depth + 1;

      dependencies.push({
        file_path: edge.target_file,
        depth: nextDepth,
      });

      if (nextDepth < maxDepth) {
        queue.push({ file: edge.target_file, depth: nextDepth });
      }
    }
  }

  dependencies.sort((a, b) => a.depth - b.depth || a.file_path.localeCompare(b.file_path));

  return {
    source_file: filePath,
    dependencies,
    dependency_count: dependencies.length,
    max_depth: maxDepth,
  };
}
