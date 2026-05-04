/**
 * Stellaris Graph View — 3D dependency graph dashboard HTML template.
 * Uses 3d-force-graph (Three.js bundled) via CDN.
 * Dark theme matching Nova Mind visual identity.
 */

export function getGraphDashboardHtml(apiBase: string): string {
  const FORCE_GRAPH_CDN = 'https://unpkg.com/3d-force-graph@1.73.3/dist/3d-force-graph.min.js';
  const langColors: Record<string, string> = {
    '.ts': '#3178c6', '.tsx': '#3178c6',
    '.js': '#f0db4f', '.jsx': '#f0db4f', '.mjs': '#f0db4f', '.cjs': '#f0db4f',
    '.py': '#3776ab', '.go': '#00add8', '.rs': '#dea584',
    '.html': '#e34c26', '.css': '#563d7c', '.scss': '#c6538c', '.less': '#1d365d',
    '.vue': '#42b883', '.svelte': '#ff3e00', '.astro': '#ff5d01',
    '.json': '#8bc34a', '.yaml': '#cb171e', '.yml': '#cb171e',
    '.md': '#6b7280', '.mdx': '#6b7280', '.sql': '#e38c00',
    '.graphql': '#e10098', '.prisma': '#2d3748', '.php': '#8993be',
  };
  const langColorsJson = JSON.stringify(langColors);
  return buildDashboardHtml(apiBase, FORCE_GRAPH_CDN, langColorsJson);
}

function buildDashboardHtml(apiBase: string, cdnUrl: string, langColorsJson: string): string {
  const HLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
  const HLJS_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Stellaris — Dependency Graph 3D</title>',
    `<link rel="stylesheet" href="${HLJS_CSS}">`,
    getCSS(),
    `<script src="${cdnUrl}"></script>`,
    `<script src="${HLJS_CDN}"></script>`,
    '</head>',
    '<body>',
    getBodyHtml(),
    '<script>',
    getScriptJs(apiBase, langColorsJson),
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

function getCSS(): string {
  return `<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d111c; --surface: #161b27; --surface2: #1e2535; --border: #2a3040;
  --text: #e2e8f0; --text-muted: #64748b; --accent: #e0366f; --accent2: #3b82f6;
  --font: 'Inter', system-ui, sans-serif; --mono: 'JetBrains Mono', 'Fira Code', monospace;
  --sb-width: 220px;
}
html, body { width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; }
#app { display: flex; flex-direction: column; height: 100vh; }
header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 12px; }
.header-left { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 15px; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
.logo span { color: var(--text-muted); font-weight: 400; }
.stats-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.pill { padding: 3px 10px; border-radius: 999px; font-size: 12px; background: var(--surface2); border: 1px solid var(--border); color: var(--text-muted); }
.pill strong { color: var(--text); }
#main { display: flex; flex: 1; overflow: hidden; }
#sidebar { width: var(--sb-width); min-width: 150px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 14px 12px; gap: 16px; overflow-y: auto; flex-shrink: 0; position: relative; }
.sb-resize-handle { position: absolute; right: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 10; background: transparent; transition: background .15s; }
.sb-resize-handle:hover, .sb-resize-handle.dragging { background: var(--accent2); opacity: 0.3; }
.sidebar-section { display: flex; flex-direction: column; gap: 8px; }
.sidebar-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.search-wrap { position: relative; }
#search-input { width: 100%; padding: 6px 10px; border-radius: 6px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-size: 13px; outline: none; }
#search-input:focus { border-color: var(--accent2); }
#search-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; z-index: 100; max-height: 200px; overflow-y: auto; display: none; }
.dropdown-item { padding: 6px 10px; cursor: pointer; font-size: 12px; font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dropdown-item:hover { background: var(--border); color: var(--accent2); }
.depth-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.depth-row label { font-size: 12px; color: var(--text-muted); }
#depth-value { font-size: 12px; color: var(--text); font-family: var(--mono); }
#depth-slider { flex: 1; accent-color: var(--accent2); cursor: pointer; }
#depth-slider:disabled { opacity: 0.5; cursor: not-allowed; }
.slider-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.slider-row label { font-size: 12px; color: var(--text-muted); }
.slider-row input[type="range"] { flex: 1; accent-color: var(--accent2); cursor: pointer; }
.slider-row .value-label { font-size: 12px; color: var(--text); font-family: var(--mono); min-width: 30px; text-align: right; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label { font-size: 12px; color: var(--text-muted); }
.toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: 999px; transition: .2s; }
.toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--text-muted); border-radius: 50%; transition: .2s; }
.toggle input:checked + .toggle-slider { background: var(--accent2); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #fff; }
#view-mode { width: 100%; padding: 6px 10px; border-radius: 6px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-size: 12px; outline: none; cursor: pointer; }
#view-mode:focus { border-color: var(--accent2); }
.camera-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.cam-btn { flex: 1; min-width: 45px; padding: 5px 8px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 11px; font-weight: 500; cursor: pointer; transition: all .15s; }
.cam-btn:hover { background: var(--border); color: var(--accent2); }
#screenshot-btn { width: 100%; padding: 6px 10px; background: var(--accent2); border: none; border-radius: 4px; color: #fff; font-size: 12px; font-weight: 500; cursor: pointer; margin-top: 6px; }
#screenshot-btn:hover { opacity: 0.85; }
.reset-folder-btn { width: 100%; padding: 5px 8px; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 11px; cursor: pointer; margin-top: 6px; }
.reset-folder-btn:hover { background: var(--border); color: var(--text); }
/* Tree UX v2 */
.tree-item { position: relative; }
.tree-folder { list-style: none; }
.tree-folder > .tree-children { margin-left: 14px; padding-left: 6px; border-left: 1px solid rgba(255,255,255,0.07); overflow: hidden; transition: max-height 0.22s ease; }
.tree-folder.collapsed > .tree-children { max-height: 0 !important; }
.tree-folder > .tree-label .chevron { display: inline-block; width: 12px; text-align: center; transition: transform 0.18s; font-size: 9px; color: #64748b; flex-shrink: 0; }
.tree-folder.collapsed > .tree-label .chevron { transform: rotate(-90deg); }
.tree-root { list-style: none; padding: 0; margin: 0; }
.tree-label { display: flex; align-items: center; gap: 5px; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: var(--mono); white-space: nowrap; overflow: hidden; }
.tree-label:hover { background: rgba(255,255,255,0.05); }
.tree-label.selected { background: rgba(224,54,111,0.2); }
.tree-label.folder-highlighted { color: var(--accent); }
.lang-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.folder-icon { font-size: 11px; flex-shrink: 0; }
.tree-name { flex: 1; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; }
.tree-name.file-name { color: #64748b; }
.file-count { font-size: 10px; color: #475569; margin-left: auto; padding-right: 2px; flex-shrink: 0; }
.ext-grid { display: flex; flex-wrap: wrap; gap: 5px; }
.ext-pill { padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid transparent; font-family: var(--mono); transition: all .15s; }
.ext-pill.off { background: transparent !important; opacity: 1; }
#graph-container { flex: 1; position: relative; overflow: hidden; }
#graph-canvas { width: 100%; height: 100%; }
.graph-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); flex-direction: column; gap: 12px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent2); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.overlay-text { color: var(--text-muted); font-size: 13px; }
.file-panel { width: 420px; min-width: 280px; max-width: 80vw; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; position: relative; }
.file-panel.hidden { width: 0; min-width: 0; overflow: hidden; border: none; }
.fp-resize-handle { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; cursor: col-resize; z-index: 10; background: transparent; transition: background .15s; }
.fp-resize-handle:hover, .fp-resize-handle.dragging { background: var(--accent2); opacity: 0.5; }
.file-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 8px; }
.file-panel-title { font-size: 12px; font-weight: 600; font-family: var(--mono); word-break: break-all; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px; flex-shrink: 0; }
.close-btn:hover { color: var(--text); }
.fp-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.fp-tab { padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); background: none; border-top: none; border-left: none; border-right: none; transition: color .15s; }
.fp-tab:hover { color: var(--text); }
.fp-tab.active { color: var(--accent2); border-bottom-color: var(--accent2); }
.fp-tab-pane { display: none; flex: 1; overflow-y: auto; }
.fp-tab-pane.active { display: flex; flex-direction: column; }
.file-panel-meta { padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; border-bottom: 1px solid var(--border); }
.panel-section { display: flex; flex-direction: column; gap: 6px; }
.panel-section-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.degree-row { display: flex; gap: 16px; }
.degree-item { display: flex; flex-direction: column; gap: 2px; }
.degree-num { font-size: 20px; font-weight: 700; color: var(--text); }
.degree-label { font-size: 11px; color: var(--text-muted); }
.open-btn { display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; flex-shrink: 0; }
.open-btn:hover { opacity: 0.85; }
.code-wrap { flex: 1; overflow: auto; background: #0a0e1a; }
.code-wrap pre { margin: 0; padding: 14px 0; font-size: 12px; line-height: 1.6; }
.code-wrap pre code { font-family: var(--mono); display: block; padding: 0 14px; }
.code-wrap pre code.hljs { background: transparent; padding: 0 14px; }
.symbol-list { display: flex; flex-direction: column; gap: 3px; padding: 10px 14px; }
.symbol-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; background: var(--surface2); cursor: pointer; }
.symbol-item:hover { background: var(--border); }
.symbol-kind { font-size: 10px; font-family: var(--mono); color: var(--accent2); min-width: 50px; flex-shrink: 0; }
.symbol-name { font-size: 12px; font-family: var(--mono); color: var(--text); flex: 1; }
.symbol-lines { font-size: 10px; color: var(--text-muted); font-family: var(--mono); }
.dep-list { display: flex; flex-direction: column; gap: 3px; padding: 10px 14px; }
.dep-item { font-size: 11px; font-family: var(--mono); color: var(--text-muted); cursor: pointer; padding: 3px 6px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dep-item:hover { background: var(--surface2); color: var(--accent2); }
.panel-spinner { display: flex; justify-content: center; padding: 20px; }
.panel-spinner .spinner { width: 24px; height: 24px; border-width: 2px; }
.fp-empty { color: var(--text-muted); font-size: 12px; padding: 14px; }
</style>`;
}

function getBodyHtml(): string {
  return `<div id="app">
  <header>
    <div class="header-left">
      <span class="logo">Stellaris <span>&bull; Dependency Graph 3D</span></span>
    </div>
    <div class="stats-pills">
      <span class="pill" id="pill-files">&mdash; files</span>
      <span class="pill" id="pill-edges">&mdash; edges</span>
    </div>
  </header>
  <div id="main">
    <div id="sidebar">
      <div class="sb-resize-handle" id="sb-resize"></div>
      <div class="sidebar-section">
        <div class="sidebar-title">Search file</div>
        <div class="search-wrap">
          <input id="search-input" type="text" placeholder="filename or path&hellip;" autocomplete="off" />
          <div id="search-dropdown"></div>
        </div>
        <div class="depth-row">
          <label for="depth-slider">Depth</label>
          <input id="depth-slider" type="range" min="1" max="5" value="2" title="Search a file first" disabled />
          <span id="depth-value">2</span>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">View mode</div>
        <select id="view-mode">
          <option value="language">By Language</option>
          <option value="directory">By Directory</option>
          <option value="degree">By Degree</option>
          <option value="impact">By Impact</option>
          <option value="dead-code">Dead Code</option>
          <option value="circular">Circular Dependencies</option>
          <option value="coupled">Coupled Nodes</option>
        </select>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Display</div>
        <div class="slider-row">
          <label for="node-size-slider">Node size</label>
          <input id="node-size-slider" type="range" min="0.3" max="3" step="0.1" value="1" />
          <span class="value-label" id="node-size-value">1</span>
        </div>
        <div class="slider-row">
          <label for="edge-width-slider">Edge width</label>
          <input id="edge-width-slider" type="range" min="0.2" max="5" step="0.2" value="1" />
          <span class="value-label" id="edge-width-value">1</span>
        </div>
        <div class="slider-row">
          <label for="link-opacity-slider">Link opacity</label>
          <input id="link-opacity-slider" type="range" min="0.05" max="1" step="0.05" value="0.3" />
          <span class="value-label" id="link-opacity-value">0.3</span>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Curved edges</span>
          <label class="toggle">
            <input type="checkbox" id="toggle-curved" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Physics</div>
        <div class="slider-row">
          <label for="charge-slider">Charge</label>
          <input id="charge-slider" type="range" min="-500" max="-20" step="10" value="-120" />
          <span class="value-label" id="charge-value">-120</span>
        </div>
        <div class="slider-row">
          <label for="link-dist-slider">Link dist</label>
          <input id="link-dist-slider" type="range" min="5" max="200" step="5" value="30" />
          <span class="value-label" id="link-dist-value">30</span>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Camera</div>
        <div class="camera-buttons">
          <button class="cam-btn" id="cam-top">Top</button>
          <button class="cam-btn" id="cam-front">Front</button>
          <button class="cam-btn" id="cam-side">Side</button>
          <button class="cam-btn" id="cam-reset">Reset</button>
        </div>
        <button id="screenshot-btn">📷 Screenshot</button>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Filters</div>
        <div class="toggle-row">
          <span class="toggle-label">Hide node_modules</span>
          <label class="toggle">
            <input type="checkbox" id="toggle-nm" checked />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">File types</div>
        <div class="ext-grid" id="ext-grid"></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Folders</div>
        <div id="folder-tree-container"></div>
        <button id="reset-folder-btn" class="reset-folder-btn" style="display:none">Reset folder filter</button>
      </div>
    </div>
    <div id="graph-container">
      <div id="graph-canvas"></div>
      <div class="graph-overlay" id="loading-overlay" style="display:flex">
        <div class="spinner"></div>
        <span class="overlay-text">Loading graph&hellip;</span>
      </div>
      <div class="graph-overlay" id="empty-overlay" style="display:none">
        <span class="overlay-text">No dependency graph found. Run <strong>reindex</strong> first.</span>
      </div>
    </div>
    <div class="file-panel hidden" id="file-panel">
      <div class="fp-resize-handle" id="fp-resize"></div>
      <div class="file-panel-header">
        <span class="file-panel-title" id="fp-title">&mdash;</span>
        <a class="open-btn" id="fp-vscode" href="#" title="Open in VS Code" style="font-size:11px;padding:5px 10px">&#x2756; VS Code</a>
        <button class="close-btn" id="fp-close" title="Close">&#x2715;</button>
      </div>
      <div class="file-panel-meta" id="fp-meta"></div>
      <div class="fp-tabs">
        <button class="fp-tab active" data-tab="code">Code</button>
        <button class="fp-tab" data-tab="symbols">Symbols</button>
        <button class="fp-tab" data-tab="imports">Imports</button>
      </div>
      <div class="fp-tab-pane active" id="fp-pane-code"></div>
      <div class="fp-tab-pane" id="fp-pane-symbols"></div>
      <div class="fp-tab-pane" id="fp-pane-imports"></div>
    </div>
  </div>
</div>`;
}

function getScriptJs(apiBase: string, langColorsJson: string): string {
  return `(function() {
  var API_BASE = '` + apiBase + `';
  var LANG_COLORS = ` + langColorsJson + `;
  var DEFAULT_COLOR = '#6b7280';

  function langColor(ext) { return LANG_COLORS[ext] || DEFAULT_COLOR; }

  function hexToRgba(hex, a) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+','+a+')';
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    function f(n) {
      var k = (n + h / 30) % 12;
      var color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    }
    return '#' + f(0) + f(8) + f(4);
  }

  function lerpColor(c1, c2, t) {
    var r1 = parseInt(c1.slice(1,3), 16);
    var g1 = parseInt(c1.slice(3,5), 16);
    var b1 = parseInt(c1.slice(5,7), 16);
    var r2 = parseInt(c2.slice(1,3), 16);
    var g2 = parseInt(c2.slice(3,5), 16);
    var b2 = parseInt(c2.slice(5,7), 16);
    var r = Math.round(r1 + (r2 - r1) * t);
    var g = Math.round(g1 + (g2 - g1) * t);
    var b = Math.round(b1 + (b2 - b1) * t);
    return '#' + ('00' + r.toString(16)).slice(-2) + ('00' + g.toString(16)).slice(-2) + ('00' + b.toString(16)).slice(-2);
  }

  function detectCycles(nodes, links) {
    var adjList = {};
    nodes.forEach(function(n) { adjList[n.id] = []; });
    links.forEach(function(l) {
      var src = typeof l.source === 'string' ? l.source : l.source.id;
      var tgt = typeof l.target === 'string' ? l.target : l.target.id;
      adjList[src].push(tgt);
    });

    var visited = {}, rec = {}, cycleIds = new Set();
    function dfs(nodeId) {
      if (rec[nodeId]) { cycleIds.add(nodeId); return true; }
      if (visited[nodeId]) return false;
      visited[nodeId] = true;
      rec[nodeId] = true;
      var hasCycle = false;
      adjList[nodeId].forEach(function(neighbor) {
        if (dfs(neighbor)) { cycleIds.add(nodeId); hasCycle = true; }
      });
      rec[nodeId] = false;
      return hasCycle;
    }
    nodes.forEach(function(n) {
      if (!visited[n.id]) dfs(n.id);
    });
    return cycleIds;
  }

  var allNodes = [], allLinks = [], projectRoot = '';
  var activeExts = new Set();
  var hideNm = true, focusFile = null, focusDepth = 2, focusFolderPrefix = null;
  var highlightFolder = null;
  var viewMode = 'language';
  var nodeSizeMult = 1, edgeWidthMult = 1, linkOpacityVal = 0.3;
  var cycleNodeIds = new Set(), degreeMax = 0;
  var graph = null, highlightNodes = new Set(), highlightLinks = new Set(), selectedNode = null;

  var elLoading = document.getElementById('loading-overlay');
  var elEmpty = document.getElementById('empty-overlay');
  var elCanvas = document.getElementById('graph-canvas');
  var elPillFiles = document.getElementById('pill-files');
  var elPillEdges = document.getElementById('pill-edges');
  var elSearch = document.getElementById('search-input');
  var elDropdown = document.getElementById('search-dropdown');
  var elDepth = document.getElementById('depth-slider');
  var elDepthVal = document.getElementById('depth-value');
  var elToggleNm = document.getElementById('toggle-nm');
  var elExtGrid = document.getElementById('ext-grid');
  var elViewMode = document.getElementById('view-mode');
  var elNodeSize = document.getElementById('node-size-slider');
  var elNodeSizeVal = document.getElementById('node-size-value');
  var elEdgeWidth = document.getElementById('edge-width-slider');
  var elEdgeWidthVal = document.getElementById('edge-width-value');
  var elLinkOpacity = document.getElementById('link-opacity-slider');
  var elLinkOpacityVal = document.getElementById('link-opacity-value');
  var elToggleCurved = document.getElementById('toggle-curved');
  var elCharge = document.getElementById('charge-slider');
  var elChargeVal = document.getElementById('charge-value');
  var elLinkDist = document.getElementById('link-dist-slider');
  var elLinkDistVal = document.getElementById('link-dist-value');
  var elCamTop = document.getElementById('cam-top');
  var elCamFront = document.getElementById('cam-front');
  var elCamSide = document.getElementById('cam-side');
  var elCamReset = document.getElementById('cam-reset');
  var elScreenshot = document.getElementById('screenshot-btn');
  var elSidebarResize = document.getElementById('sb-resize');
  var elResetFolder = document.getElementById('reset-folder-btn');
  var elFolderContainer = document.getElementById('folder-tree-container');
  var elPanel = document.getElementById('file-panel');
  var elFpTitle = document.getElementById('fp-title');
  var elFpVscode = document.getElementById('fp-vscode');
  var elFpMeta = document.getElementById('fp-meta');
  var elFpClose = document.getElementById('fp-close');
  var elPaneCode = document.getElementById('fp-pane-code');
  var elPaneSymbols = document.getElementById('fp-pane-symbols');
  var elPaneImports = document.getElementById('fp-pane-imports');
  var fpTabs = document.querySelectorAll('.fp-tab');
  var elSidebar = document.getElementById('sidebar');

  fpTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      fpTabs.forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      var pane = tab.dataset.tab;
      elPaneCode.classList.toggle('active', pane === 'code');
      elPaneSymbols.classList.toggle('active', pane === 'symbols');
      elPaneImports.classList.toggle('active', pane === 'imports');
    });
  });

  elFpClose.addEventListener('click', function() {
    elPanel.classList.add('hidden');
    selectedNode = null;
    refreshHighlight();
  });

  elPanel.addEventListener('mousedown', function(e) {
    if (e.target.id !== 'fp-resize') return;
    e.preventDefault();
    var startX = e.clientX, startW = elPanel.offsetWidth;
    function onMove(me) {
      var delta = startX - me.clientX;
      var newW = startW + delta;
      newW = Math.max(280, Math.min(window.innerWidth * 0.8, newW));
      elPanel.style.width = newW + 'px';
      if (graph) graph.width(document.getElementById('graph-container').offsetWidth);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  elSidebarResize.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var startX = e.clientX, startW = elSidebar.offsetWidth;
    function onMove(me) {
      var delta = me.clientX - startX;
      var newW = startW + delta;
      newW = Math.max(150, Math.min(500, newW));
      document.documentElement.style.setProperty('--sb-width', newW + 'px');
      if (graph) graph.width(document.getElementById('graph-container').offsetWidth);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  elSearch.addEventListener('input', function() {
    var val = this.value.trim().toLowerCase();
    if (!val) {
      elDropdown.style.display = 'none';
      elDepth.disabled = true;
      elDepth.title = 'Search a file first';
      return;
    }
    elDepth.disabled = false;
    elDepth.removeAttribute('title');
    var matches = allNodes.filter(function(n) { return n.id.toLowerCase().includes(val); }).slice(0, 15);
    elDropdown.innerHTML = '';
    if (matches.length === 0) { elDropdown.style.display = 'none'; return; }
    matches.forEach(function(m) {
      var item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = m.id;
      item.addEventListener('click', function() {
        focusFile = m.id;
        focusDepth = parseInt(elDepth.value);
        elSearch.value = m.id;
        elDropdown.style.display = 'none';
        renderGraph();
      });
      elDropdown.appendChild(item);
    });
    elDropdown.style.display = 'block';
  });

  elDepth.addEventListener('input', function() {
    focusDepth = parseInt(this.value);
    elDepthVal.textContent = focusDepth;
    if (focusFile) renderGraph();
  });

  elToggleNm.addEventListener('change', function() {
    hideNm = this.checked;
    renderGraph();
  });

  elViewMode.addEventListener('change', function() {
    viewMode = this.value;
    refreshColors();
  });

  elNodeSize.addEventListener('input', function() {
    nodeSizeMult = parseFloat(this.value);
    elNodeSizeVal.textContent = nodeSizeMult.toFixed(1);
    if (graph) graph.nodeVal(function(n) { return (n.size || 4) * nodeSizeMult; });
  });

  elEdgeWidth.addEventListener('input', function() {
    edgeWidthMult = parseFloat(this.value);
    elEdgeWidthVal.textContent = edgeWidthMult.toFixed(1);
    if (graph) graph.linkWidth(function(l) { return (l.width || 1) * edgeWidthMult; });
  });

  elLinkOpacity.addEventListener('input', function() {
    linkOpacityVal = parseFloat(this.value);
    elLinkOpacityVal.textContent = linkOpacityVal.toFixed(2);
    if (graph) graph.linkColor(function(l) {
      var c = '#64748b';
      if (highlightLinks.has(l.id)) c = '#3b82f6';
      return hexToRgba(c, linkOpacityVal);
    });
  });

  elToggleCurved.addEventListener('change', function() {
    if (graph) graph.linkCurvature(this.checked ? 0.3 : 0);
  });

  elCharge.addEventListener('input', function() {
    var val = parseInt(this.value);
    elChargeVal.textContent = val;
    if (graph) {
      graph.d3Force('charge').strength(val);
      graph.d3ReheatSimulation();
    }
  });

  elLinkDist.addEventListener('input', function() {
    var val = parseInt(this.value);
    elLinkDistVal.textContent = val;
    if (graph) {
      graph.d3Force('link').distance(val);
      graph.d3ReheatSimulation();
    }
  });

  elCamTop.addEventListener('click', function() {
    if (graph) graph.cameraPosition({x: 0, y: 600, z: 0}, {x: 0, y: 0, z: 0}, 800);
  });

  elCamFront.addEventListener('click', function() {
    if (graph) graph.cameraPosition({x: 0, y: 0, z: 600}, {x: 0, y: 0, z: 0}, 800);
  });

  elCamSide.addEventListener('click', function() {
    if (graph) graph.cameraPosition({x: 600, y: 0, z: 0}, {x: 0, y: 0, z: 0}, 800);
  });

  elCamReset.addEventListener('click', function() {
    if (graph) graph.zoomToFit(800);
  });

  elScreenshot.addEventListener('click', function() {
    if (!graph) return;
    var canvas = graph.renderer().domElement;
    canvas.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'graph.png';
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  elResetFolder.addEventListener('click', function() {
    focusFolderPrefix = null;
    highlightFolder = null;
    elResetFolder.style.display = 'none';
    renderGraph();
  });

  function buildFolderTree(nodes) {
    // Build a recursive tree from node paths
    var root = { __files: [], __dirs: {} };
    nodes.forEach(function(n) {
      var parts = n.id.replace(/\\\\/g, '/').split('/');
      var cur = root;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (i === parts.length - 1) {
          cur.__files.push(n.id);
        } else {
          if (!cur.__dirs[p]) cur.__dirs[p] = { __files: [], __dirs: {} };
          cur = cur.__dirs[p];
        }
      }
    });

    function countFiles(node) {
      var c = node.__files.length;
      Object.keys(node.__dirs).forEach(function(k) { c += countFiles(node.__dirs[k]); });
      return c;
    }

    // Build full prefix path for a folder given ancestor prefixes
    function renderNode(dirObj, dirName, fullPrefix, depth) {
      var li = document.createElement('li');
      li.className = 'tree-folder' + (depth >= 2 ? ' collapsed' : '');

      var label = document.createElement('div');
      label.className = 'tree-label';

      var chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▾';

      var folderIcon = document.createElement('span');
      folderIcon.className = 'folder-icon';
      folderIcon.textContent = depth === 0 ? '📁' : '📂';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'tree-name';
      nameSpan.textContent = dirName + '/';

      var countSpan = document.createElement('span');
      countSpan.className = 'file-count';
      countSpan.textContent = countFiles(dirObj);

      label.appendChild(chevron);
      label.appendChild(folderIcon);
      label.appendChild(nameSpan);
      label.appendChild(countSpan);

      // Toggle collapse
      label.addEventListener('click', function(e) {
        e.stopPropagation();
        var isCollapsed = li.classList.contains('collapsed');
        li.classList.toggle('collapsed');
        var children = li.querySelector('.tree-children');
        if (children) {
          var total = countFiles(dirObj) * 22 + 4;
          children.style.maxHeight = isCollapsed ? total + 'px' : '0px';
        }
      });

      // Single-click: highlight folder
      nameSpan.addEventListener('click', function(e) {
        e.stopPropagation();
        if (highlightFolder === fullPrefix) {
          highlightFolder = null;
          document.querySelectorAll('.tree-label.folder-highlighted').forEach(function(el) { el.classList.remove('folder-highlighted'); });
        } else {
          document.querySelectorAll('.tree-label.folder-highlighted').forEach(function(el) { el.classList.remove('folder-highlighted'); });
          highlightFolder = fullPrefix;
          label.classList.add('folder-highlighted');
        }
        refreshColors();
      });

      // Double-click: filter graph to folder
      label.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        focusFolderPrefix = fullPrefix;
        elResetFolder.style.display = 'block';
        focusFile = null;
        renderGraph();
      });

      var children = document.createElement('ul');
      children.className = 'tree-children';
      var totalH = countFiles(dirObj) * 22 + 4;
      children.style.maxHeight = depth >= 2 ? '0px' : totalH + 'px';

      // Dirs first (sorted), then files (sorted)
      var subDirKeys = Object.keys(dirObj.__dirs).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
      subDirKeys.forEach(function(k) {
        children.appendChild(renderNode(dirObj.__dirs[k], k, fullPrefix + k + '/', depth + 1));
      });

      var sortedFiles = dirObj.__files.slice().sort(function(a, b) {
        return a.split('/').pop().toLowerCase().localeCompare(b.split('/').pop().toLowerCase());
      });
      sortedFiles.forEach(function(fid) {
        var fli = document.createElement('li');
        fli.className = 'tree-item';
        fli.setAttribute('data-id', fid);

        var flabel = document.createElement('div');
        flabel.className = 'tree-label';
        flabel.setAttribute('data-nodeid', fid);

        var ext = fid.substring(fid.lastIndexOf('.'));
        var dot = document.createElement('span');
        dot.className = 'lang-dot';
        dot.style.background = langColor(ext);

        var fname = document.createElement('span');
        fname.className = 'tree-name file-name';
        fname.textContent = fid.split('/').pop();

        flabel.appendChild(dot);
        flabel.appendChild(fname);
        flabel.addEventListener('click', function(e) {
          e.stopPropagation();
          document.querySelectorAll('.tree-label.selected').forEach(function(el) { el.classList.remove('selected'); });
          flabel.classList.add('selected');
          openFilePanel(fid);
        });

        fli.appendChild(flabel);
        children.appendChild(fli);
      });

      li.appendChild(label);
      li.appendChild(children);
      return li;
    }

    var ul = document.createElement('ul');
    ul.className = 'tree-root';

    var topDirs = Object.keys(root.__dirs).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    topDirs.forEach(function(k) {
      ul.appendChild(renderNode(root.__dirs[k], k, k + '/', 0));
    });
    // Files at root level
    root.__files.slice().sort().forEach(function(fid) {
      var fli = document.createElement('li');
      fli.className = 'tree-item';
      var flabel = document.createElement('div');
      flabel.className = 'tree-label';
      flabel.setAttribute('data-nodeid', fid);
      var ext = fid.substring(fid.lastIndexOf('.'));
      var dot = document.createElement('span');
      dot.className = 'lang-dot';
      dot.style.background = langColor(ext);
      var fname = document.createElement('span');
      fname.className = 'tree-name file-name';
      fname.textContent = fid.split('/').pop();
      flabel.appendChild(dot);
      flabel.appendChild(fname);
      flabel.addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelectorAll('.tree-label.selected').forEach(function(el) { el.classList.remove('selected'); });
        flabel.classList.add('selected');
        openFilePanel(fid);
      });
      fli.appendChild(flabel);
      ul.appendChild(fli);
    });

    elFolderContainer.innerHTML = '';
    elFolderContainer.appendChild(ul);
  }

  function getFilteredData() {
    var nodes = allNodes.slice();
    var links = allLinks.slice();

    if (hideNm) nodes = nodes.filter(function(n) { return n.id.indexOf('node_modules') === -1; });
    if (activeExts.size > 0) {
      nodes = nodes.filter(function(n) {
        var ext = n.id.substring(n.id.lastIndexOf('.'));
        return activeExts.has(ext);
      });
    }
    if (focusFolderPrefix) {
      nodes = nodes.filter(function(n) { return n.id.indexOf(focusFolderPrefix) === 0; });
    }

    if (focusFile && nodes.some(function(n) { return n.id === focusFile; })) {
      var nodeMap = {};
      nodes.forEach(function(n) { nodeMap[n.id] = true; });
      var visited = {}, queue = [focusFile];
      var bfsNodes = {};
      bfsNodes[focusFile] = 0;
      visited[focusFile] = true;

      for (var i = 0; i < queue.length; i++) {
        var nodeId = queue[i], depth = bfsNodes[nodeId];
        if (depth >= focusDepth) continue;

        links.forEach(function(l) {
          var src = typeof l.source === 'string' ? l.source : l.source.id;
          var tgt = typeof l.target === 'string' ? l.target : l.target.id;
          if (src === nodeId && nodeMap[tgt] && !visited[tgt]) {
            visited[tgt] = true;
            bfsNodes[tgt] = depth + 1;
            queue.push(tgt);
          } else if (tgt === nodeId && nodeMap[src] && !visited[src]) {
            visited[src] = true;
            bfsNodes[src] = depth + 1;
            queue.push(src);
          }
        });
      }
      nodes = nodes.filter(function(n) { return bfsNodes[n.id] !== undefined; });
    }

    var nodeSet = {};
    nodes.forEach(function(n) { nodeSet[n.id] = true; });
    links = links.filter(function(l) {
      var src = typeof l.source === 'string' ? l.source : l.source.id;
      var tgt = typeof l.target === 'string' ? l.target : l.target.id;
      return nodeSet[src] && nodeSet[tgt];
    });

    return { nodes: nodes, links: links };
  }

  function nodeOpacity(n) {
    if (highlightFolder) {
      return n.id.indexOf(highlightFolder) === 0 ? 1.0 : 0.12;
    }
    if (highlightNodes.size > 0) {
      return highlightNodes.has(n.id) ? 1.0 : 0.15;
    }
    return 0.92;
  }

  function nodeColorFunc(n) {
    // Folder highlight: dim nodes outside selected folder
    if (highlightFolder && n.id.indexOf(highlightFolder) !== 0) return '#1e2535';
    // Hover highlight
    if (highlightNodes.size > 0 && !highlightNodes.has(n.id)) return '#1e2535';

    if (viewMode === 'language') {
      var ext = n.id.substring(n.id.lastIndexOf('.'));
      return langColor(ext);
    } else if (viewMode === 'directory') {
      var dir = n.directory || '';
      var hue = (hashStr(dir) * 137) % 360;
      return hslToHex(hue, 65, 55);
    } else if (viewMode === 'degree') {
      var deg = (n.in_degree || 0) + (n.out_degree || 0);
      var t = degreeMax > 0 ? deg / degreeMax : 0;
      return lerpColor('#3b82f6', '#ef4444', t);
    } else if (viewMode === 'impact') {
      if (!selectedNode) return langColor(n.id.substring(n.id.lastIndexOf('.')));
      if (n.id === selectedNode) return '#ef4444';
      var dist = highlightNodes.has(n.id) ? 1 : 999;
      highlightLinks.forEach(function(lid) {
        if (lid.includes(n.id)) dist = Math.min(dist, 1);
      });
      if (dist === 1) return '#fb923c';
      return '#6b7280';
    } else if (viewMode === 'dead-code') {
      var isEntry = n.id.match(/\\/(index|main)\\.(ts|js|tsx|jsx)$/i) || n.id.match(/\\.(config|test|spec)\\./i);
      var hasIncoming = (n.in_degree || 0) > 0;
      if (!hasIncoming && !isEntry) return '#ef4444';
      return '#22c55e';
    } else if (viewMode === 'circular') {
      if (cycleNodeIds.has(n.id)) return '#ef4444';
      return '#374151';
    } else if (viewMode === 'coupled') {
      var deg = (n.in_degree || 0) + (n.out_degree || 0);
      var sortedDegrees = Array.from(allNodes).map(function(x) { return (x.in_degree || 0) + (x.out_degree || 0); }).sort(function(a, b) { return b - a; });
      var top10 = sortedDegrees[Math.floor(sortedDegrees.length * 0.1)];
      if (deg >= top10) {
        var t = (deg - top10) / (sortedDegrees[0] - top10 || 1);
        return lerpColor('#fbbf24', '#ef4444', t);
      }
      return '#6b7280';
    }
    return langColor(n.id.substring(n.id.lastIndexOf('.')));
  }

  function linkColorFunc(l) {
    var c = '#64748b';
    if (highlightLinks.has(l.id)) c = '#3b82f6';
    return hexToRgba(c, linkOpacityVal);
  }

  function refreshColors() {
    if (!graph) return;
    graph
      .nodeColor(nodeColorFunc)
      .nodeOpacity(0.92)
      .linkColor(linkColorFunc)
      .linkWidth(function(l) { return highlightLinks.has(l.id) ? 1.5 * edgeWidthMult : 0.5 * edgeWidthMult; });
  }

  function renderGraph() {
    if (!graph) return;
    var data = getFilteredData();
    graph.graphData(data);
    elPillFiles.innerHTML = '<strong>' + data.nodes.length + '</strong> files';
    elPillEdges.innerHTML = '<strong>' + data.links.length + '</strong> edges';
    refreshColors();
  }

  function refreshHighlight() {
    if (!graph) return;
    highlightNodes.clear();
    highlightLinks.clear();
    refreshColors();
  }

  function openFilePanel(nodeId) {
    selectedNode = nodeId;
    var node = allNodes.find(function(n) { return n.id === nodeId; });
    if (!node) return;

    elFpTitle.textContent = nodeId;
    elFpVscode.href = 'vscode://file/' + projectRoot + '/' + nodeId;

    elFpMeta.innerHTML = '';
    var degSection = document.createElement('div');
    degSection.className = 'panel-section';
    var degTitle = document.createElement('div');
    degTitle.className = 'panel-section-title';
    degTitle.textContent = 'Degree';
    var degRow = document.createElement('div');
    degRow.className = 'degree-row';
    var inItem = document.createElement('div');
    inItem.className = 'degree-item';
    var inNum = document.createElement('div');
    inNum.className = 'degree-num';
    inNum.textContent = node.in_degree || 0;
    var inLabel = document.createElement('div');
    inLabel.className = 'degree-label';
    inLabel.textContent = 'In';
    inItem.appendChild(inNum);
    inItem.appendChild(inLabel);
    var outItem = document.createElement('div');
    outItem.className = 'degree-item';
    var outNum = document.createElement('div');
    outNum.className = 'degree-num';
    outNum.textContent = node.out_degree || 0;
    var outLabel = document.createElement('div');
    outLabel.className = 'degree-label';
    outLabel.textContent = 'Out';
    outItem.appendChild(outNum);
    outItem.appendChild(outLabel);
    degRow.appendChild(inItem);
    degRow.appendChild(outItem);
    degSection.appendChild(degTitle);
    degSection.appendChild(degRow);
    elFpMeta.appendChild(degSection);

    elPaneCode.innerHTML = '';
    elPaneCode.innerHTML = '<div class="panel-spinner"><div class="spinner"></div></div>';

    var xhrCode = new XMLHttpRequest();
    xhrCode.open('GET', API_BASE + '/api/file-source?file=' + encodeURIComponent(nodeId), true);
    xhrCode.onload = function() {
      if (xhrCode.status === 200) {
        try {
          var resp = JSON.parse(xhrCode.responseText);
          var content = resp.content || '';
          var pre = document.createElement('pre');
          var code = document.createElement('code');
          code.textContent = content;
          pre.appendChild(code);
          var wrap = document.createElement('div');
          wrap.className = 'code-wrap';
          wrap.appendChild(pre);
          elPaneCode.innerHTML = '';
          elPaneCode.appendChild(wrap);
          if (window.hljs) {
            try { hljs.highlightElement(code); } catch(e) {}
          }
        } catch(e) { elPaneCode.innerHTML = '<div class="fp-empty">Could not load file.</div>'; }
      }
    };
    xhrCode.send();

    elPaneSymbols.innerHTML = '';
    var xhrSymbols = new XMLHttpRequest();
    xhrSymbols.open('GET', API_BASE + '/api/file-outline?file=' + encodeURIComponent(nodeId), true);
    xhrSymbols.onload = function() {
      if (xhrSymbols.status === 200) {
        try {
          var resp = JSON.parse(xhrSymbols.responseText);
          var symbols = resp.symbols || [];
          var list = document.createElement('div');
          list.className = 'symbol-list';
          if (symbols.length === 0) {
            var empty = document.createElement('div'); empty.className = 'fp-empty'; empty.textContent = 'No symbols found';
            list.appendChild(empty);
          } else {
            symbols.forEach(function(s) {
              var item = document.createElement('div');
              item.className = 'symbol-item';
              var kind = document.createElement('span');
              kind.className = 'symbol-kind';
              kind.textContent = (s.kind || 'unknown').toUpperCase();
              var name = document.createElement('span');
              name.className = 'symbol-name';
              name.textContent = s.name || '?';
              var lines = document.createElement('span');
              lines.className = 'symbol-lines';
              lines.textContent = s.lines || '';
              item.appendChild(kind);
              item.appendChild(name);
              item.appendChild(lines);
              list.appendChild(item);
            });
          }
          elPaneSymbols.innerHTML = '';
          elPaneSymbols.appendChild(list);
        } catch(e) {
          elPaneSymbols.innerHTML = '<div class="fp-empty">Error parsing symbols</div>';
        }
      }
    };
    xhrSymbols.send();

    elPaneImports.innerHTML = '';
    (function() {
      var deps = [], rdeps = [];
      allLinks.forEach(function(l) {
        var src = typeof l.source === 'string' ? l.source : (l.source && l.source.id);
        var tgt = typeof l.target === 'string' ? l.target : (l.target && l.target.id);
        if (src === nodeId) deps.push(tgt);
        if (tgt === nodeId) rdeps.push(src);
      });
      function makeDepList(ids, title) {
        if (ids.length === 0) return null;
        var sec = document.createElement('div'); sec.className = 'panel-section'; sec.style.cssText = 'padding:10px 14px 0';
        var t = document.createElement('div'); t.className = 'panel-section-title'; t.textContent = title + ' (' + ids.length + ')';
        sec.appendChild(t);
        var list = document.createElement('div'); list.className = 'dep-list';
        ids.forEach(function(id) {
          var parts = id.replace(/\\\\/g, '/').split('/');
          var it = document.createElement('div'); it.className = 'dep-item'; it.title = id; it.textContent = parts[parts.length-1];
          it.addEventListener('click', function() { openFilePanel(id); });
          list.appendChild(it);
        });
        sec.appendChild(list);
        return sec;
      }
      var outSec = makeDepList(deps, 'Imports');
      var inSec = makeDepList(rdeps, 'Imported by');
      if (!outSec && !inSec) {
        var e = document.createElement('div'); e.className = 'fp-empty'; e.textContent = 'No import edges found.';
        elPaneImports.appendChild(e);
      } else {
        if (outSec) elPaneImports.appendChild(outSec);
        if (inSec) elPaneImports.appendChild(inSec);
      }
    })();

    elPanel.classList.remove('hidden');
    highlightNodes.clear();
    highlightLinks.clear();
    allLinks.forEach(function(l) {
      var src = typeof l.source === 'string' ? l.source : l.source.id;
      var tgt = typeof l.target === 'string' ? l.target : l.target.id;
      if (src === nodeId || tgt === nodeId) {
        highlightLinks.add(l.id);
        if (src === nodeId) highlightNodes.add(tgt);
        if (tgt === nodeId) highlightNodes.add(src);
      }
    });
    highlightNodes.add(nodeId);
    refreshColors();

    // Zoom camera to this node in the 3D graph
    if (graph) {
      var gNodes = graph.graphData().nodes;
      var targetNode = null;
      for (var zi = 0; zi < gNodes.length; zi++) {
        if (gNodes[zi].id === nodeId) { targetNode = gNodes[zi]; break; }
      }
      if (targetNode && typeof targetNode.x === 'number') {
        var dist = 80;
        graph.cameraPosition(
          { x: targetNode.x + dist, y: targetNode.y + dist * 0.5, z: targetNode.z + dist },
          { x: targetNode.x, y: targetNode.y, z: targetNode.z },
          800
        );
      }
    }
  }

  function initGraph(apiBase) {
    var GRAPH_DB_URL = apiBase + '/api/data';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', GRAPH_DB_URL, true);
    xhr.responseType = 'json';
    xhr.onload = function() {
      if (xhr.status !== 200) {
        elLoading.style.display = 'none';
        elEmpty.style.display = 'flex';
        return;
      }
      var gdata = xhr.response;
      allNodes = gdata.nodes || [];
      allLinks = gdata.links || [];
      projectRoot = gdata.project_root || '';

      allNodes.forEach(function(n) {
        n.size = 4;
        var ext = n.id.substring(n.id.lastIndexOf('.'));
        activeExts.add(ext);
      });

      allLinks.forEach(function(l, i) { l.id = i; });

      degreeMax = 0;
      allNodes.forEach(function(n) {
        var deg = (n.in_degree || 0) + (n.out_degree || 0);
        degreeMax = Math.max(degreeMax, deg);
      });

      cycleNodeIds = detectCycles(allNodes, allLinks);

      buildFolderTree(allNodes);

      var extSortedList = Array.from(activeExts).sort();
      elExtGrid.innerHTML = '';
      extSortedList.forEach(function(ext) {
        var pill = document.createElement('div');
        pill.className = 'ext-pill';
        pill.textContent = ext;
        pill.style.background = langColor(ext);
        pill.style.color = '#fff';
        pill.style.opacity = '1';
        pill.addEventListener('click', function() {
          var color = langColor(ext);
          if (activeExts.has(ext)) {
            activeExts.delete(ext);
            pill.classList.add('off');
            pill.style.borderColor = color;
            pill.style.color = color;
          } else {
            activeExts.add(ext);
            pill.classList.remove('off');
            pill.style.background = color;
            pill.style.borderColor = 'transparent';
            pill.style.color = '#fff';
          }
          renderGraph();
        });
        elExtGrid.appendChild(pill);
      });

      elLoading.style.display = 'none';

      var container = document.getElementById('graph-canvas');
      graph = ForceGraph3D()(container)
        .backgroundColor('#0d111c')
        .graphData(getFilteredData())
        .nodeId('id')
        .nodeLabel(function(n) { return n.label + '  in:' + n.in_degree + '  out:' + n.out_degree; })
        .nodeColor(nodeColorFunc)
        .nodeOpacity(0.92)
        .nodeVal(function(n) { return Math.max(1, Math.min(8, 1 + ((n.in_degree||0)+(n.out_degree||0))*0.5)) * nodeSizeMult; })
        .linkColor(linkColorFunc)
        .linkOpacity(0.6)
        .linkWidth(function(l) { return highlightLinks.has(l.id) ? 1.5 * edgeWidthMult : 0.5 * edgeWidthMult; })
        .linkDirectionalArrowLength(3)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalArrowColor(function() { return '#4a5568'; })
        .onNodeHover(function(node) {
          highlightNodes.clear(); highlightLinks.clear();
          if (node) {
            highlightNodes.add(node.id);
            graph.graphData().links.forEach(function(l) {
              var src = typeof l.source === 'object' ? l.source.id : l.source;
              var tgt = typeof l.target === 'object' ? l.target.id : l.target;
              if (src === node.id || tgt === node.id) {
                highlightLinks.add(l.id);
                highlightNodes.add(src);
                highlightNodes.add(tgt);
              }
            });
          }
          refreshColors();
        })
        .onNodeClick(function(n) { selectedNode = n.id; refreshColors(); openFilePanel(n.id); });

      // Slower decay for better clustering convergence
      graph.d3AlphaDecay(0.02);

      // Cluster force: nodes from same directory attract toward shared center
      var clusterCenters = {};
      (function() {
        var dirSet = {};
        allNodes.forEach(function(n) { dirSet[n.directory || ''] = true; });
        var dirs = Object.keys(dirSet);
        var goldenAngle = Math.PI * (3 - Math.sqrt(5));
        var spread = Math.pow(dirs.length, 0.45) * 60;
        dirs.forEach(function(dir, i) {
          var y = 1 - (i / Math.max(dirs.length - 1, 1)) * 2;
          var radius = Math.sqrt(1 - y * y);
          var theta = goldenAngle * i;
          clusterCenters[dir] = {
            x: Math.cos(theta) * radius * spread,
            y: y * spread,
            z: Math.sin(theta) * radius * spread
          };
        });
      })();

      graph.d3Force('cluster', function(alpha) {
        var strength = 0.25 * alpha;
        var ns = graph.graphData().nodes;
        ns.forEach(function(n) {
          var center = clusterCenters[n.directory || ''];
          if (!center) return;
          n.vx = (n.vx || 0) + (center.x - (n.x || 0)) * strength;
          n.vy = (n.vy || 0) + (center.y - (n.y || 0)) * strength;
          n.vz = (n.vz || 0) + (center.z - (n.z || 0)) * strength;
        });
      });

      renderGraph();

      // Auto zoom-to-fit after simulation settles
      setTimeout(function() { if (graph) graph.zoomToFit(800, 50); }, 3500);
    };
    xhr.send();
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { initGraph(API_BASE); });
    } else {
      initGraph(API_BASE);
    }
  });

  if (document.readyState !== 'loading') {
    initGraph(API_BASE);
  }
})();
`;
}
