/**
 * Mermaid renderer — produces a ```mermaid graph LR``` block from GraphData.
 *
 * Uses subgraphs for architectural layers (classifyLayer).
 * Output is a self-contained string ready to paste in a README or PR description.
 * Renders natively on GitHub, GitLab, and Obsidian.
 */

import { basename } from 'node:path';
import type { GraphData, GraphNode } from '../export.js';
import { classifyLayer } from '../layers.js';

export interface MermaidOptions {
  /** Max nodes to include (sorted by in_degree + out_degree desc). 0 = unlimited. */
  topCoupled?: number;
  /** Only include nodes whose path contains this substring. */
  focusDir?: string;
  /** Exclude nodes with in_degree === 0 AND out_degree === 0. Default true. */
  excludeIsolated?: boolean;
}

/**
 * Sanitize a file path into a valid Mermaid node ID (alphanumeric + underscores).
 * The ID must be unique per node across the graph.
 */
function nodeId(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '').replace(/_+$/g, '');
}

/**
 * Short label for a Mermaid node: basename without leading dot (e.g. "index.ts").
 * Mermaid labels are wrapped in quotes to allow dots and hyphens.
 */
function nodeLabel(filePath: string): string {
  return basename(filePath);
}

/** Apply filters and sorting to the node list. */
function filterNodes(nodes: GraphNode[], opts: MermaidOptions): GraphNode[] {
  let result = nodes;

  if (opts.focusDir) {
    const focus = opts.focusDir.replace(/\\/g, '/');
    result = result.filter(n => n.id.replace(/\\/g, '/').includes(focus));
  }

  if (opts.excludeIsolated !== false) {
    result = result.filter(n => n.in_degree > 0 || n.out_degree > 0);
  }

  if (opts.topCoupled && opts.topCoupled > 0) {
    result = [...result]
      .sort((a, b) => (b.in_degree + b.out_degree) - (a.in_degree + a.out_degree))
      .slice(0, opts.topCoupled);
  }

  return result;
}

/**
 * Render a Mermaid graph LR block from GraphData.
 * Returns the full fenced code block (```mermaid ... ```).
 */
export function renderMermaid(data: GraphData, opts: MermaidOptions = {}): string {
  const filteredNodes = filterNodes(data.nodes, opts);
  const nodeIds = new Set(filteredNodes.map(n => n.id));

  // Group nodes by layer
  const byLayer = new Map<string, GraphNode[]>();
  for (const node of filteredNodes) {
    const { layer } = classifyLayer(node.id);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }

  // Only keep edges where both endpoints are in our filtered set
  const filteredLinks = data.links.filter(
    l => nodeIds.has(l.source) && nodeIds.has(l.target)
  );

  const lines: string[] = [];
  lines.push('graph LR');
  lines.push('');

  // Subgraph per layer
  for (const [layer, nodes] of byLayer) {
    // Sanitize subgraph id (no spaces)
    const sgId = layer.replace(/[^a-zA-Z0-9]/g, '_');
    lines.push(`  subgraph ${sgId}["${layer}"]`);
    for (const node of nodes) {
      lines.push(`    ${nodeId(node.id)}["${nodeLabel(node.id)}"]`);
    }
    lines.push('  end');
    lines.push('');
  }

  // Edges
  if (filteredLinks.length > 0) {
    lines.push('  %% Dependencies');
    for (const link of filteredLinks) {
      lines.push(`  ${nodeId(link.source)} --> ${nodeId(link.target)}`);
    }
    lines.push('');
  }

  // Summary comment
  lines.push(`  %% ${filteredNodes.length} files · ${filteredLinks.length} edges`);

  return '```mermaid\n' + lines.join('\n') + '\n```';
}
