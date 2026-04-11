/**
 * Tool: simulate_move
 * Simulates moving a file from one path to another.
 * Reports which files need import updates and what the new import strings should be.
 */

import { posix } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { getAllEdges, hasGraph } from '../graph/store.js';

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Recompute the relative import path from `importerFile` to `targetFile`,
 * both given as relative paths from project root.
 */
function computeNewImport(importerFile: string, newTargetFile: string): string {
  // Work in forward-slash posix paths
  const importerDir = posix.dirname(toForwardSlash(importerFile));
  const target = toForwardSlash(newTargetFile);

  let rel = posix.relative(importerDir, target);
  if (!rel.startsWith('.')) rel = './' + rel;

  // Strip common TS extensions to match import style (importers use .js in ESM or no ext)
  // We return with .js since this is a TypeScript ESM project
  const withoutExt = rel.replace(/\.(ts|tsx)$/, '.js');
  return withoutExt;
}

export async function handleSimulateMove(args: Record<string, unknown>) {
  const from = args.from as string;
  const to = args.to as string;

  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
    return {
      content: [{
        type: 'text' as const,
        text: 'Error: both "from" and "to" parameters are required (relative paths from project root).',
      }],
      isError: true,
    };
  }

  const projectRoot = findProjectRoot(process.cwd());

  if (!(await hasGraph(projectRoot))) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NO_GRAPH',
          message: 'No dependency graph found. Please run reindex first.',
        }, null, 2),
      }],
      isError: true,
    };
  }

  const edges = await getAllEdges(projectRoot);
  const fromNorm = toForwardSlash(from);
  const toNorm = toForwardSlash(to);

  // 1. Files that import `from` (their import paths need updating)
  const directConsumers = edges
    .filter(e => toForwardSlash(e.target_file) === fromNorm)
    .map(e => e.source_file);

  // 2. Compute the new import string for each consumer
  const importsToUpdate = directConsumers.map(consumer => {
    const oldImport = computeNewImport(consumer, fromNorm);
    const newImport = computeNewImport(consumer, toNorm);
    return {
      file: consumer,
      old_import: oldImport,
      new_import: newImport,
    };
  });

  // 3. Files that `from` imports (their paths in the moved file need updating)
  const dependenciesOfMoved = edges
    .filter(e => toForwardSlash(e.source_file) === fromNorm)
    .map(e => ({
      target: e.target_file,
      old_import: computeNewImport(fromNorm, e.target_file),
      new_import: computeNewImport(toNorm, e.target_file),
    }))
    .filter(d => d.old_import !== d.new_import);

  const totalChanges = importsToUpdate.length + dependenciesOfMoved.length;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        summary: `Moving ${fromNorm} → ${toNorm} requires ${totalChanges} import update(s).`,
        from: fromNorm,
        to: toNorm,
        direct_consumers: directConsumers,
        imports_to_update: importsToUpdate,
        dependencies_of_moved: dependenciesOfMoved,
        total_changes: totalChanges,
        note: directConsumers.length === 0
          ? 'No files import this file directly. The move is safe.'
          : `${directConsumers.length} file(s) import this file and will need their import paths updated.`,
      }, null, 2),
    }],
  };
}
