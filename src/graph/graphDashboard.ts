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
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Stellaris — Dependency Graph 3D</title>',
    getCSS(),
    `<script src="${cdnUrl}"></script>`,
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
#sidebar { width: 220px; min-width: 200px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 14px 12px; gap: 16px; overflow-y: auto; flex-shrink: 0; }
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
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label { font-size: 12px; color: var(--text-muted); }
.toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: 999px; transition: .2s; }
.toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--text-muted); border-radius: 50%; transition: .2s; }
.toggle input:checked + .toggle-slider { background: var(--accent2); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #fff; }
.ext-grid { display: flex; flex-wrap: wrap; gap: 5px; }
.ext-pill { padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid transparent; font-family: var(--mono); transition: opacity .15s; }
.ext-pill.off { opacity: 0.35; }
#graph-container { flex: 1; position: relative; overflow: hidden; }
#graph-canvas { width: 100%; height: 100%; }
.graph-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); flex-direction: column; gap: 12px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent2); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.overlay-text { color: var(--text-muted); font-size: 13px; }
.file-panel { width: 280px; min-width: 260px; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0; }
.file-panel.hidden { width: 0; min-width: 0; overflow: hidden; border: none; }
.file-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.file-panel-title { font-size: 13px; font-weight: 600; font-family: var(--mono); word-break: break-all; }
.close-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px; flex-shrink: 0; }
.close-btn:hover { color: var(--text); }
.file-panel-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; flex: 1; }
.panel-section { display: flex; flex-direction: column; gap: 6px; }
.panel-section-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.degree-row { display: flex; gap: 16px; }
.degree-item { display: flex; flex-direction: column; gap: 2px; }
.degree-num { font-size: 20px; font-weight: 700; color: var(--text); }
.degree-label { font-size: 11px; color: var(--text-muted); }
.open-btn { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.open-btn:hover { opacity: 0.85; }
.symbol-list { display: flex; flex-direction: column; gap: 3px; }
.symbol-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; background: var(--surface2); }
.symbol-kind { font-size: 10px; font-family: var(--mono); color: var(--accent2); min-width: 50px; flex-shrink: 0; }
.symbol-name { font-size: 12px; font-family: var(--mono); color: var(--text); }
.dep-list { display: flex; flex-direction: column; gap: 3px; }
.dep-item { font-size: 11px; font-family: var(--mono); color: var(--text-muted); cursor: pointer; padding: 3px 6px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dep-item:hover { background: var(--surface2); color: var(--accent2); }
.panel-spinner { display: flex; justify-content: center; padding: 20px; }
.panel-spinner .spinner { width: 24px; height: 24px; border-width: 2px; }
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
      <div class="sidebar-section">
        <div class="sidebar-title">Search file</div>
        <div class="search-wrap">
          <input id="search-input" type="text" placeholder="filename or path&hellip;" autocomplete="off" />
          <div id="search-dropdown"></div>
        </div>
        <div class="depth-row">
          <label for="depth-slider">Depth</label>
          <input id="depth-slider" type="range" min="1" max="5" value="2" />
          <span id="depth-value">2</span>
        </div>
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
      <div class="file-panel-header">
        <span class="file-panel-title" id="fp-title">&mdash;</span>
        <button class="close-btn" id="fp-close" title="Close">&#x2715;</button>
      </div>
      <div class="file-panel-body" id="fp-body"></div>
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
  var allNodes = [], allLinks = [], projectRoot = '';
  var activeExts = new Set();
  var hideNm = true, focusFile = null, focusDepth = 2;
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
  var elPanel = document.getElementById('file-panel');
  var elFpTitle = document.getElementById('fp-title');
  var elFpBody = document.getElementById('fp-body');
  var elFpClose = document.getElementById('fp-close');

  function loadData() {
    fetch(API_BASE + '/api/data').then(function(r){ return r.json(); }).then(function(data) {
      allNodes = data.nodes || []; allLinks = data.links || []; projectRoot = data.project_root || '';
      if (allNodes.length === 0) { elLoading.style.display='none'; elEmpty.style.display='flex'; return; }
      elPillFiles.textContent = data.stats.total_files + ' files';
      elPillEdges.textContent = data.stats.total_edges + ' edges';
      var extSet = new Set(allNodes.map(function(n){ return n.extension; }).filter(Boolean));
      activeExts = new Set(extSet);
      buildExtFilters(extSet);
      elLoading.style.display = 'none';
      renderGraph();
    }).catch(function(e) {
      elLoading.style.display='none'; elEmpty.style.display='flex';
      elEmpty.querySelector('.overlay-text').textContent = 'Error: ' + e.message;
    });
  }

  function buildExtFilters(extSet) {
    while (elExtGrid.firstChild) elExtGrid.removeChild(elExtGrid.firstChild);
    Array.from(extSet).sort().forEach(function(ext) {
      var color = langColor(ext);
      var pill = document.createElement('span');
      pill.className = 'ext-pill'; pill.textContent = ext;
      pill.style.background = hexToRgba(color, 0.18);
      pill.style.color = color; pill.style.borderColor = hexToRgba(color, 0.4);
      pill.dataset.ext = ext;
      pill.addEventListener('click', function() {
        if (activeExts.has(ext)) { activeExts.delete(ext); pill.classList.add('off'); }
        else { activeExts.add(ext); pill.classList.remove('off'); }
        renderGraph();
      });
      elExtGrid.appendChild(pill);
    });
  }

  function getId(n) { return typeof n === 'object' ? n.id : n; }

  function getFilteredData() {
    var nodes = allNodes.filter(function(n) {
      if (hideNm && n.id.indexOf('node_modules') !== -1) return false;
      if (n.extension && !activeExts.has(n.extension)) return false;
      return true;
    });
    var nodeIds = new Set(nodes.map(function(n){ return n.id; }));
    var links = allLinks.filter(function(l){ return nodeIds.has(getId(l.source)) && nodeIds.has(getId(l.target)); });
    if (focusFile) {
      var visited = new Set();
      var queue = [{id: focusFile, d: 0}];
      while (queue.length > 0) {
        var cur = queue.shift();
        if (visited.has(cur.id)) continue;
        visited.add(cur.id);
        if (cur.d < focusDepth) {
          links.forEach(function(l) {
            var s = getId(l.source), t = getId(l.target);
            if (s === cur.id && !visited.has(t)) queue.push({id: t, d: cur.d+1});
            if (t === cur.id && !visited.has(s)) queue.push({id: s, d: cur.d+1});
          });
        }
      }
      nodes = nodes.filter(function(n){ return visited.has(n.id); });
      var subIds = new Set(nodes.map(function(n){ return n.id; }));
      links = links.filter(function(l){ return subIds.has(getId(l.source)) && subIds.has(getId(l.target)); });
    }
    return {nodes: nodes, links: links};
  }

  function refreshColors() {
    if (!graph) return;
    graph.nodeColor(graph.nodeColor()).linkColor(graph.linkColor()).linkWidth(graph.linkWidth());
  }

  function renderGraph() {
    var fd = getFilteredData();
    if (graph) { graph.graphData(fd); return; }
    graph = ForceGraph3D()(elCanvas)
      .backgroundColor('#0d111c').nodeId('id')
      .nodeLabel(function(n){ return n.label + '  in:' + n.in_degree + '  out:' + n.out_degree; })
      .nodeColor(function(n) {
        if (selectedNode && selectedNode.id === n.id) return '#e0366f';
        if (highlightNodes.has(n.id)) return '#ffffff';
        return langColor(n.extension);
      })
      .nodeVal(function(n){ return Math.max(1, Math.min(8, 1+((n.in_degree||0)+(n.out_degree||0))*0.5)); })
      .nodeOpacity(0.92)
      .linkColor(function(l){ return highlightLinks.has(l) ? '#3b82f6' : '#2a3040'; })
      .linkOpacity(0.5).linkWidth(function(l){ return highlightLinks.has(l) ? 1.5 : 0.5; })
      .linkDirectionalArrowLength(3).linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor(function(){ return '#4a5568'; })
      .onNodeHover(function(node) {
        highlightNodes.clear(); highlightLinks.clear();
        if (node) {
          highlightNodes.add(node.id);
          graph.graphData().links.forEach(function(l) {
            var s = getId(l.source), t = getId(l.target);
            if (s === node.id || t === node.id) { highlightLinks.add(l); highlightNodes.add(s); highlightNodes.add(t); }
          });
        }
        refreshColors();
      })
      .onNodeClick(function(node) { selectedNode = node; refreshColors(); showFilePanel(node); })
      .graphData(fd);
  }

  function safePath(p) { return p.replace(/\\\\/g, '/'); }

  function showFilePanel(node) {
    elPanel.classList.remove('hidden');
    elFpTitle.textContent = node.label;
    var vscodeUrl = 'vscode://file/' + safePath(node.id);
    var secDeg = document.createElement('div'); secDeg.className = 'panel-section';
    var titleDeg = document.createElement('div'); titleDeg.className = 'panel-section-title'; titleDeg.textContent = 'Connections';
    var degRow = document.createElement('div'); degRow.className = 'degree-row';
    [{lbl:'incoming',val:node.in_degree},{lbl:'outgoing',val:node.out_degree}].forEach(function(d) {
      var item = document.createElement('div'); item.className = 'degree-item';
      var num = document.createElement('span'); num.className = 'degree-num'; num.textContent = d.val;
      var lbl = document.createElement('span'); lbl.className = 'degree-label'; lbl.textContent = d.lbl;
      item.appendChild(num); item.appendChild(lbl); degRow.appendChild(item);
    });
    secDeg.appendChild(titleDeg); secDeg.appendChild(degRow);
    var openBtn = document.createElement('a'); openBtn.className = 'open-btn'; openBtn.href = vscodeUrl; openBtn.textContent = 'Open in VS Code';
    var links = graph.graphData().links;
    var deps = links.filter(function(l){ return getId(l.source)===node.id; }).map(function(l){ return getId(l.target); });
    var secDeps = null;
    if (deps.length > 0) {
      secDeps = document.createElement('div'); secDeps.className = 'panel-section';
      var titleDeps = document.createElement('div'); titleDeps.className='panel-section-title'; titleDeps.textContent='Imports ('+deps.length+')';
      var depList = document.createElement('div'); depList.className = 'dep-list';
      deps.forEach(function(d) {
        var parts = safePath(d).split('/'), name = parts[parts.length-1];
        var item = document.createElement('div'); item.className='dep-item'; item.title=d; item.textContent=name;
        item.addEventListener('click', function(){ window.__stellarisGvFocus(d); });
        depList.appendChild(item);
      });
      secDeps.appendChild(titleDeps); secDeps.appendChild(depList);
    }
    var secSym = document.createElement('div'); secSym.className='panel-section'; secSym.id='fp-symbols-section';
    var titleSym = document.createElement('div'); titleSym.className='panel-section-title'; titleSym.textContent='Symbols';
    var spinWrap = document.createElement('div'); spinWrap.className='panel-spinner';
    var spinEl = document.createElement('div'); spinEl.className='spinner';
    spinWrap.appendChild(spinEl); secSym.appendChild(titleSym); secSym.appendChild(spinWrap);
    while (elFpBody.firstChild) elFpBody.removeChild(elFpBody.firstChild);
    elFpBody.appendChild(secDeg); elFpBody.appendChild(openBtn);
    if (secDeps) elFpBody.appendChild(secDeps);
    elFpBody.appendChild(secSym);
    fetch(API_BASE + '/api/file-outline?file=' + encodeURIComponent(node.id))
      .then(function(r){ return r.json(); })
      .then(function(data) {
        var sec = document.getElementById('fp-symbols-section');
        if (!sec) return;
        while (sec.firstChild) sec.removeChild(sec.firstChild);
        var symbols = data.symbols || [];
        var t = document.createElement('div'); t.className='panel-section-title'; t.textContent='Symbols ('+symbols.length+')';
        sec.appendChild(t);
        if (symbols.length === 0) {
          var e2 = document.createElement('div'); e2.style.cssText='color:var(--text-muted);font-size:12px'; e2.textContent='No symbols found'; sec.appendChild(e2); return;
        }
        var list = document.createElement('div'); list.className='symbol-list';
        symbols.slice(0,30).forEach(function(s) {
          var item = document.createElement('div'); item.className='symbol-item';
          var kind = document.createElement('span'); kind.className='symbol-kind'; kind.textContent=s.kind||'';
          var name = document.createElement('span'); name.className='symbol-name'; name.textContent=s.name;
          item.appendChild(kind); item.appendChild(name); list.appendChild(item);
        });
        sec.appendChild(list);
        if (symbols.length>30) { var more=document.createElement('div'); more.style.cssText='color:var(--text-muted);font-size:11px;padding:4px 8px'; more.textContent='+'+(symbols.length-30)+' more\u2026'; sec.appendChild(more); }
      })
      .catch(function() { var sec=document.getElementById('fp-symbols-section'); if(sec){while(sec.firstChild)sec.removeChild(sec.firstChild);} });
  }

  window.__stellarisGvFocus = function(filePath) {
    focusFile = filePath;
    var parts = safePath(filePath).split('/');
    elSearch.value = parts[parts.length-1] || filePath;
    elDropdown.style.display = 'none';
    renderGraph();
    setTimeout(function() {
      var node = graph.graphData().nodes.find(function(n){ return n.id===filePath; });
      if (node) { selectedNode=node; refreshColors(); showFilePanel(node); }
    }, 300);
  };

  var searchTimer;
  elSearch.addEventListener('input', function() {
    clearTimeout(searchTimer);
    var q = elSearch.value.trim().toLowerCase();
    if (!q) { elDropdown.style.display='none'; focusFile=null; renderGraph(); return; }
    searchTimer = setTimeout(function() {
      var matches = allNodes.filter(function(n){ return n.id.toLowerCase().indexOf(q)!==-1||n.label.toLowerCase().indexOf(q)!==-1; }).slice(0,20);
      if (!matches.length) { elDropdown.style.display='none'; return; }
      while (elDropdown.firstChild) elDropdown.removeChild(elDropdown.firstChild);
      matches.forEach(function(n) {
        var item = document.createElement('div'); item.className='dropdown-item'; item.dataset.id=n.id; item.title=n.id;
        item.textContent = n.label + '  ' + safePath(n.id).replace(safePath(projectRoot),'').replace(/^\\//, '');
        elDropdown.appendChild(item);
      });
      elDropdown.style.display='block';
    }, 150);
  });

  elDropdown.addEventListener('click', function(e) {
    var item = e.target.closest('.dropdown-item');
    if (!item) return;
    var id = item.dataset.id;
    elDropdown.style.display='none'; elSearch.value=item.title.split('/').pop()||id;
    focusFile=id; renderGraph();
    setTimeout(function() {
      var node=graph.graphData().nodes.find(function(n){return n.id===id;});
      if (node){selectedNode=node;refreshColors();showFilePanel(node);}
    }, 300);
  });

  document.addEventListener('click', function(e) {
    if (!elSearch.contains(e.target)&&!elDropdown.contains(e.target)) elDropdown.style.display='none';
  });
  elSearch.addEventListener('keydown', function(e) {
    if (e.key==='Escape'){elSearch.value='';focusFile=null;elDropdown.style.display='none';renderGraph();}
  });
  elDepth.addEventListener('input', function() {
    focusDepth=parseInt(elDepth.value); elDepthVal.textContent=elDepth.value;
    if (focusFile) renderGraph();
  });
  elToggleNm.addEventListener('change', function() { hideNm=elToggleNm.checked; renderGraph(); });
  elFpClose.addEventListener('click', function() { elPanel.classList.add('hidden'); selectedNode=null; if(graph)refreshColors(); });
  loadData();
})();`;
}
