/**
 * HTML renderer — wraps the SVG output in a dark-theme standalone HTML page.
 *
 * Features:
 * - Self-contained: zero external requests, all styles inline
 * - Legend with clickable layer filters (highlight/dim on click)
 * - Hover tooltip showing full path + degree info
 * - "Download SVG" button
 *
 * Built with textContent/createElement patterns (no innerHTML) for XSS safety.
 * The SVG itself is embedded as a trusted string (generated server-side from code paths,
 * never from user input).
 */

import type { GraphData } from '../export.js';
import { renderSvg, type SvgOptions } from './svg.js';
import { allLayers } from '../layers.js';

export type HtmlOptions = SvgOptions;

export function renderHtml(data: GraphData, opts: HtmlOptions = {}): string {
  const svgContent = renderSvg(data, opts);
  const projectName = data.project_root.split(/[/\\]/).filter(Boolean).pop() ?? 'Project';

  // Legend items JSON for client-side JS
  const layers = allLayers();
  const legendJson = JSON.stringify(
    layers.map(l => ({ layer: l.layer, color: l.color, badge: l.badge }))
  );

  // We build pure HTML as a string. The only dynamic values injected are:
  //   - projectName: derived from a filesystem path (no HTML specials possible)
  //   - svgContent: output of renderSvg (trusted, generated from file paths)
  //   - legendJson: JSON-serialized, safe in a JS string literal delimited by backticks
  //     (JSON.stringify escapes backticks as \u0060 — safe).
  //   - Stats numbers: numeric only.
  const safeProjectName = projectName.replace(/[<>"&]/g, c =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&amp;'
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeProjectName} — Architecture Diagram</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', system-ui, monospace; min-height: 100vh; }
  header { background: #1e293b; border-bottom: 1px solid #334155; padding: 12px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header h1 { font-size: 16px; font-weight: 700; color: #f8fafc; letter-spacing: .5px; }
  header .stats { font-size: 12px; color: #94a3b8; }
  .toolbar { margin-left: auto; display: flex; gap: 8px; }
  button { background: #1e3a5f; border: 1px solid #2563eb; color: #93c5fd; padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: background .15s; }
  button:hover { background: #2563eb; color: #fff; }
  #legend { background: #1e293b; border-bottom: 1px solid #334155; padding: 8px 20px; display: flex; flex-wrap: wrap; gap: 8px; }
  .legend-item { display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 3px 8px; border-radius: 4px; border: 1px solid transparent; font-size: 11px; color: #cbd5e1; user-select: none; transition: border-color .15s, background .15s; }
  .legend-item:hover { background: #334155; }
  .legend-item.active { border-color: var(--layer-color); background: rgba(255,255,255,.04); }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  #graph-wrap { overflow: auto; padding: 20px; }
  #graph-wrap svg { display: block; border-radius: 8px; border: 1px solid #334155; }
  .dim-layer rect[data-layer]:not(.active-layer) { opacity: 0.12 !important; }
</style>
</head>
<body>
<header>
  <h1 id="proj-title"></h1>
  <span class="stats" id="proj-stats"></span>
  <div class="toolbar">
    <button id="btn-reset">Reset filter</button>
    <button id="btn-download">Download SVG</button>
  </div>
</header>
<div id="legend"></div>
<div id="graph-wrap">
  <div id="svg-container">${svgContent}</div>
</div>
<script>
(function() {
  'use strict';
  var projectName = ${JSON.stringify(safeProjectName)};
  var totalFiles = ${data.nodes.length};
  var totalEdges = ${data.links.length};
  var layers = ${legendJson};

  // Header
  document.getElementById('proj-title').textContent = projectName + ' — Architecture Diagram';
  document.getElementById('proj-stats').textContent = totalFiles + ' files · ' + totalEdges + ' edges';

  // Legend
  var legend = document.getElementById('legend');
  var activeLayer = null;
  layers.forEach(function(l) {
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.style.setProperty('--layer-color', l.color);
    item.dataset.layer = l.layer;

    var dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = l.color;

    var label = document.createTextNode(l.badge + ' ' + l.layer);

    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener('click', function() {
      if (activeLayer === l.layer) {
        activeLayer = null;
        item.classList.remove('active');
        clearHighlight();
      } else {
        activeLayer = l.layer;
        legend.querySelectorAll('.legend-item').forEach(function(el) { el.classList.remove('active'); });
        item.classList.add('active');
        highlightLayer(l.layer);
      }
    });
    legend.appendChild(item);
  });

  // Reset button
  document.getElementById('btn-reset').addEventListener('click', function() {
    activeLayer = null;
    legend.querySelectorAll('.legend-item').forEach(function(el) { el.classList.remove('active'); });
    clearHighlight();
  });

  // Download button
  document.getElementById('btn-download').addEventListener('click', function() {
    var svgEl = document.querySelector('#svg-container svg');
    if (!svgEl) return;
    var serializer = new XMLSerializer();
    var svgStr = serializer.serializeToString(svgEl);
    var blob = new Blob([svgStr], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = projectName.replace(/[^a-zA-Z0-9_-]/g, '_') + '-architecture.svg';
    a.click();
    URL.revokeObjectURL(url);
  });

  function highlightLayer(layerName) {
    var svgEl = document.querySelector('#svg-container svg');
    if (!svgEl) return;
    // Dim all node groups, highlight matching ones
    // Node <g> elements contain a <title> with the path. We use stroke color on <rect>.
    // We match by checking each column header text (subgraph label).
    // Simpler: we look at rect stroke color matching the layer color.
    var targetColor = null;
    layers.forEach(function(l) { if (l.layer === layerName) targetColor = l.color.toLowerCase(); });
    if (!targetColor) return;

    svgEl.querySelectorAll('g').forEach(function(g) {
      var rect = g.querySelector('rect[stroke]');
      if (!rect) return;
      var stroke = rect.getAttribute('stroke').toLowerCase();
      var opacity = (stroke === targetColor) ? '1' : '0.08';
      g.style.opacity = opacity;
    });
  }

  function clearHighlight() {
    var svgEl = document.querySelector('#svg-container svg');
    if (!svgEl) return;
    svgEl.querySelectorAll('g').forEach(function(g) {
      g.style.opacity = '';
    });
  }
})();
</script>
</body>
</html>`;
}
