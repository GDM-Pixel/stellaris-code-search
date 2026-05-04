/**
 * SVG renderer — produces a standalone dark-theme SVG from GraphData.
 *
 * Layout: vertical columns, one per architectural layer.
 * Nodes are rounded rectangles with a colored left border.
 * Edges are bezier curves with arrowheads.
 * No external dependencies — pure string output.
 */

import { basename } from 'node:path';
import type { GraphData, GraphNode } from '../export.js';
import { classifyLayer, allLayers, type LayerInfo } from '../layers.js';

export interface SvgOptions {
  topCoupled?: number;
  focusDir?: string;
  excludeIsolated?: boolean;
  /** SVG canvas width in px. Default 1100. */
  width?: number;
}

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_W = 140;
const NODE_H = 28;
const NODE_RX = 5;
const BORDER_W = 4;
const COL_PADDING_X = 20;
const NODE_GAP_Y = 10;
const TOP_MARGIN = 80;   // header area
const BOTTOM_MARGIN = 60; // legend area
const COL_MIN_W = NODE_W + COL_PADDING_X * 2;
const FONT = 'monospace';
const FONT_SIZE = 11;

interface LayoutNode {
  node: GraphNode;
  layer: LayerInfo;
  x: number;
  y: number;
}

interface Column {
  layer: LayerInfo;
  nodes: GraphNode[];
  x: number;
  width: number;
  height: number;
}

function filterNodes(nodes: GraphNode[], opts: SvgOptions): GraphNode[] {
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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(label: string, maxChars = 17): string {
  return label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
}

/** Cubic bezier from (x1,y1) to (x2,y2) with horizontal control points. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

export function renderSvg(data: GraphData, opts: SvgOptions = {}): string {
  const canvasWidth = opts.width ?? 1100;
  const filteredNodes = filterNodes(data.nodes, opts);
  const nodeIds = new Set(filteredNodes.map(n => n.id));

  // Group by layer preserving layer order
  const layerOrder = allLayers().map(l => l.layer);
  const byLayer = new Map<string, GraphNode[]>();
  for (const node of filteredNodes) {
    const { layer } = classifyLayer(node.id);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }

  // Build columns in layer order (skip empty layers)
  const usedLayers = layerOrder.filter(l => byLayer.has(l));
  const colCount = usedLayers.length || 1;
  const colW = Math.max(COL_MIN_W, Math.floor(canvasWidth / colCount));

  const columns: Column[] = [];
  let cx = 0;
  for (const layerName of usedLayers) {
    const nodes = byLayer.get(layerName)!;
    const layerInfo = classifyLayer(nodes[0].id);
    const colHeight = nodes.length * (NODE_H + NODE_GAP_Y) + NODE_GAP_Y + 30; // 30 = subgraph title
    columns.push({ layer: layerInfo, nodes, x: cx, width: colW, height: colHeight });
    cx += colW;
  }

  const totalWidth = cx || canvasWidth;
  const maxColHeight = columns.reduce((m, c) => Math.max(m, c.height), 0);
  const totalHeight = TOP_MARGIN + maxColHeight + BOTTOM_MARGIN;

  // Compute per-node layout positions
  const layoutMap = new Map<string, LayoutNode>();
  for (const col of columns) {
    const nodeX = col.x + COL_PADDING_X;
    let nodeY = TOP_MARGIN + 30 + NODE_GAP_Y; // below subgraph title
    for (const node of col.nodes) {
      layoutMap.set(node.id, { node, layer: col.layer, x: nodeX, y: nodeY });
      nodeY += NODE_H + NODE_GAP_Y;
    }
  }

  // Filtered edges
  const filteredLinks = data.links.filter(
    l => nodeIds.has(l.source) && nodeIds.has(l.target)
  );

  const svgParts: string[] = [];

  // SVG header
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" style="background:#0f172a;font-family:${FONT};font-size:${FONT_SIZE}px;">`);

  // Arrowhead marker
  svgParts.push(`
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#475569"/>
    </marker>
  </defs>`);

  // Header
  const projectName = esc(data.project_root.split(/[/\\]/).filter(Boolean).pop() ?? 'Project');
  svgParts.push(`
  <!-- Header -->
  <rect x="0" y="0" width="${totalWidth}" height="${TOP_MARGIN - 4}" fill="#1e293b"/>
  <text x="16" y="32" fill="#e2e8f0" font-size="16" font-weight="bold">${projectName}</text>
  <text x="16" y="52" fill="#94a3b8" font-size="11">${filteredNodes.length} files · ${filteredLinks.length} edges · generated by Stellaris graph_export</text>`);

  // Column backgrounds + subgraph titles
  for (const col of columns) {
    const y = TOP_MARGIN;
    const h = totalHeight - TOP_MARGIN - BOTTOM_MARGIN;
    svgParts.push(`
  <!-- Column: ${esc(col.layer.layer)} -->
  <rect x="${col.x}" y="${y}" width="${col.width}" height="${h}" fill="#1e293b" stroke="#334155" stroke-width="1" rx="4"/>
  <text x="${col.x + col.width / 2}" y="${y + 20}" fill="${col.layer.color}" font-size="11" font-weight="bold" text-anchor="middle">${esc(col.layer.badge)} ${esc(col.layer.layer)}</text>`);
  }

  // Edges (behind nodes)
  svgParts.push('\n  <!-- Edges -->');
  for (const link of filteredLinks) {
    const src = layoutMap.get(link.source);
    const tgt = layoutMap.get(link.target);
    if (!src || !tgt) continue;
    const x1 = src.x + NODE_W;
    const y1 = src.y + NODE_H / 2;
    const x2 = tgt.x;
    const y2 = tgt.y + NODE_H / 2;
    svgParts.push(`  <path d="${bezierPath(x1, y1, x2, y2)}" fill="none" stroke="#334155" stroke-width="1.2" marker-end="url(#arrow)" opacity="0.6"/>`);
  }

  // Nodes
  svgParts.push('\n  <!-- Nodes -->');
  for (const [, ln] of layoutMap) {
    const { x, y, layer } = ln;
    const label = truncate(basename(ln.node.id));
    const degree = ln.node.in_degree + ln.node.out_degree;
    const tooltip = `${esc(ln.node.id)} (in:${ln.node.in_degree} out:${ln.node.out_degree})`;
    svgParts.push(`
  <g>
    <title>${tooltip}</title>
    <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="${NODE_RX}" fill="#0f172a" stroke="${layer.color}" stroke-width="0.8"/>
    <rect x="${x}" y="${y}" width="${BORDER_W}" height="${NODE_H}" rx="${NODE_RX}" fill="${layer.color}" opacity="${degree > 0 ? '0.9' : '0.4'}"/>
    <text x="${x + BORDER_W + 6}" y="${y + NODE_H / 2 + 4}" fill="#e2e8f0" font-size="${FONT_SIZE}">${esc(label)}</text>
  </g>`);
  }

  // Legend
  const legendY = totalHeight - BOTTOM_MARGIN + 12;
  svgParts.push(`\n  <!-- Legend -->`);
  const usedLayerInfos = columns.map(c => c.layer);
  let lx = 12;
  for (const info of usedLayerInfos) {
    svgParts.push(`  <rect x="${lx}" y="${legendY}" width="10" height="10" fill="${info.color}" rx="2"/>`);
    svgParts.push(`  <text x="${lx + 14}" y="${legendY + 9}" fill="#94a3b8" font-size="10">${esc(info.layer)}</text>`);
    lx += 80;
    if (lx + 80 > totalWidth) break;
  }

  svgParts.push('\n</svg>');

  return svgParts.join('\n');
}
