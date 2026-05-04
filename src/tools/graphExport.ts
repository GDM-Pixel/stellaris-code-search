/**
 * Tool: graph_export
 * Generates a static architecture diagram from the dependency graph.
 *
 * Formats:
 *   mermaid — ```mermaid graph LR``` block with subgraphs per architectural layer
 *   svg     — standalone dark-theme SVG file
 *   html    — self-contained dark-theme HTML page with legend + download button
 *
 * Uses classifyLayer() to group files into semantic layers (Tools, Storage, Graph, etc.)
 * based on directory-name heuristics — no LLM required, data comes from graph.db.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { findProjectRoot } from '../indexer/scanner.js';
import { buildGraphData } from '../graph/export.js';
import { renderMermaid } from '../graph/renderers/mermaid.js';
import { renderSvg } from '../graph/renderers/svg.js';
import { renderHtml } from '../graph/renderers/html.js';

type ExportFormat = 'mermaid' | 'svg' | 'html';

interface ExportOptions {
  format: ExportFormat;
  outputPath?: string;
  focusDir?: string;
  topCoupled?: number;
  excludeIsolated?: boolean;
}

const EXT: Record<ExportFormat, string> = {
  mermaid: 'md',
  svg: 'svg',
  html: 'html',
};

function parseArgs(args: Record<string, unknown>): ExportOptions {
  const format = (['mermaid', 'svg', 'html'].includes(args.format as string)
    ? args.format as ExportFormat
    : 'mermaid');

  const outputPath = typeof args.output_path === 'string' ? args.output_path : undefined;
  const focusDir = typeof args.focus_dir === 'string' ? args.focus_dir : undefined;
  const topCoupled = typeof args.top_coupled === 'number' && args.top_coupled > 0
    ? args.top_coupled : undefined;
  const excludeIsolated = args.exclude_isolated === false ? false : true;

  return { format, outputPath, focusDir, topCoupled, excludeIsolated };
}

export async function handleGraphExport(args: Record<string, unknown>): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const opts = parseArgs(args);
  const projectRoot = findProjectRoot(process.cwd());

  // Load graph data
  let data;
  try {
    data = await buildGraphData(projectRoot);
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ Impossible de lire le graphe : ${String(err)}\n\nLance d'abord \`reindex\` pour construire le graphe de dépendances.` }],
      isError: true,
    } as never;
  }

  if (!data.nodes.length) {
    return {
      content: [{ type: 'text', text: '⚠️ Le graphe est vide. Lance `reindex` pour indexer le projet.' }],
    };
  }

  // Render
  const renderOpts = {
    focusDir: opts.focusDir,
    topCoupled: opts.topCoupled,
    excludeIsolated: opts.excludeIsolated,
  };

  let rendered: string;
  switch (opts.format) {
    case 'svg':
      rendered = renderSvg(data, renderOpts);
      break;
    case 'html':
      rendered = renderHtml(data, renderOpts);
      break;
    default:
      rendered = renderMermaid(data, renderOpts);
  }

  // Determine output path
  const vectorsDir = join(projectRoot, '.vectors');
  const defaultFile = `graph-export.${EXT[opts.format]}`;
  const outPath = opts.outputPath ?? join(vectorsDir, defaultFile);

  // Write to file
  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, rendered, 'utf-8');
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ Erreur d'écriture du fichier : ${String(err)}` }],
    };
  }

  // Count filtered nodes/edges for the summary
  // (approximate from rendered content — simpler than re-running the filter)
  const totalNodes = data.nodes.length;
  const totalEdges = data.links.length;

  // Build response
  const lines: string[] = [];
  lines.push(`## Architecture Diagram — \`${opts.format}\``);
  lines.push('');
  lines.push(`**Fichier généré :** \`${outPath}\``);
  lines.push(`**Projet :** \`${projectRoot}\``);
  lines.push(`**Stats graphe complet :** ${totalNodes} fichiers · ${totalEdges} dépendances`);
  if (opts.focusDir) lines.push(`**Filtre répertoire :** \`${opts.focusDir}\``);
  if (opts.topCoupled) lines.push(`**Top couplés :** ${opts.topCoupled} fichiers`);
  if (opts.excludeIsolated) lines.push(`**Nœuds isolés :** exclus`);
  lines.push('');

  if (opts.format === 'mermaid') {
    lines.push('**Diagramme (copier dans un README) :**');
    lines.push('');
    lines.push(rendered);
    lines.push('');
    lines.push('> Le diagramme est rendu nativement sur GitHub, GitLab et Obsidian.');
  } else if (opts.format === 'svg') {
    lines.push('**Ouvrir le SVG :**');
    lines.push(`\`\`\`\nstart ${outPath}\n\`\`\``);
    lines.push('');
    lines.push('> Ouvrir dans un navigateur ou dans VS Code (clic sur le fichier .svg).');
  } else {
    lines.push('**Ouvrir le dashboard HTML :**');
    lines.push(`\`\`\`\nstart ${outPath}\n\`\`\``);
    lines.push('');
    lines.push('> Page HTML standalone dark-theme avec légende interactive et bouton "Download SVG".');
    lines.push('> Aucune connexion réseau requise — tout est inline.');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
