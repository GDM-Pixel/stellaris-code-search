/**
 * Graph export — transforms graph.db edges into {nodes, links} for 3D visualization.
 */

import { extname, basename, relative } from 'node:path';
import { getAllEdges } from './store.js';

export interface GraphNode {
  id: string;           // relative file path (key)
  label: string;        // filename only
  extension: string;    // ".ts", ".py", etc.
  directory: string;    // top-level directory (for clustering hints)
  in_degree: number;    // files that import this node
  out_degree: number;   // files this node imports
}

export interface GraphLink {
  source: string;
  target: string;
  import_names: string[];
}

export interface GraphStats {
  total_files: number;
  total_edges: number;
  languages: Record<string, number>;  // extension → count
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: GraphStats;
  project_root: string;
}

/**
 * Build the full graph data structure from graph.db edges.
 */
export async function buildGraphData(projectRoot: string): Promise<GraphData> {
  const edges = await getAllEdges(projectRoot);

  // Collect unique file paths and compute degrees
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const nodeSet = new Set<string>();

  for (const edge of edges) {
    nodeSet.add(edge.source_file);
    nodeSet.add(edge.target_file);
    outDegree.set(edge.source_file, (outDegree.get(edge.source_file) ?? 0) + 1);
    inDegree.set(edge.target_file, (inDegree.get(edge.target_file) ?? 0) + 1);
  }

  // Build nodes
  const langCount: Record<string, number> = {};
  const nodes: GraphNode[] = Array.from(nodeSet).map(filePath => {
    const ext = extname(filePath).toLowerCase();
    langCount[ext] = (langCount[ext] ?? 0) + 1;

    // Top-level directory relative to project root
    const rel = filePath.startsWith(projectRoot)
      ? relative(projectRoot, filePath)
      : filePath;
    const parts = rel.replace(/\\/g, '/').split('/');
    const topDir = parts.length > 1 ? parts[0] : '.';

    return {
      id: filePath,
      label: basename(filePath),
      extension: ext,
      directory: topDir,
      in_degree: inDegree.get(filePath) ?? 0,
      out_degree: outDegree.get(filePath) ?? 0,
    };
  });

  // Build links
  const links: GraphLink[] = edges.map(e => ({
    source: e.source_file,
    target: e.target_file,
    import_names: e.import_names,
  }));

  return {
    nodes,
    links,
    stats: {
      total_files: nodes.length,
      total_edges: edges.length,
      languages: langCount,
    },
    project_root: projectRoot,
  };
}
