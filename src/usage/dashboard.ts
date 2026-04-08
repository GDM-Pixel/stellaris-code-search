/**
 * Claude Code Usage Dashboard — HTML template
 * Single-page app with Chart.js. Dark theme, inline CSS+JS.
 * Data comes from our own local API (localhost SQLite) — no external user input.
 */

// Chart.js CDN
const CHARTJS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Poppins:wght@400;600;700&display=swap');
  :root {
    --bg:#0d111c;--card:#14192a;--card2:#1a2137;--border:#212a45;
    --text:#f1f2eb;--muted:#a3a88f;
    --accent:#d52050;--accent2:#e02c5c;--accent3:#8e1535;
    --cyan:#2b7ea1;--cyan2:#3ea1cc;--cyan3:#226581;
    --green:#10b981;--yellow:#f59e0b;--red:#ef4444;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Poppins',sans-serif;font-size:14px;line-height:1.5}
  h1,h2,h3{font-family:'Inter',sans-serif}
  .container{max-width:1400px;margin:0 auto;padding:24px}
  header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:16px}
  header h1{font-size:20px;font-weight:800;letter-spacing:-.01em}
  header h1 .brand{color:var(--cyan2)}
  header h1 .sep{color:var(--border);margin:0 6px}
  header h1 span{color:var(--accent)}
  .badge{background:var(--card2);border:1px solid var(--border);border-radius:99px;padding:4px 12px;font-size:12px;color:var(--muted);font-weight:600}
  .filters{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:20px}
  .filter-group{display:flex;gap:6px}
  .range-btn{background:var(--card2);border:1px solid var(--border);border-radius:99px;padding:5px 14px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600;font-family:'Poppins',sans-serif;transition:all .2s}
  .range-btn:hover{background:var(--card);color:var(--text)}
  .range-btn.active{background:linear-gradient(135deg,var(--accent2),var(--accent3));border-color:transparent;color:#fff}
  .model-pill{display:flex;align-items:center;gap:6px;background:var(--card2);border:1px solid var(--border);border-radius:99px;padding:4px 12px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600;transition:all .2s;user-select:none}
  .model-pill.active{border-color:var(--cyan2);color:var(--text)}
  .model-pill .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
  .stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;position:relative;overflow:hidden;transition:box-shadow .2s}
  .stat-card:hover{box-shadow:0 0 20px rgba(43,126,161,0.3)}
  .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(135deg,var(--accent2),var(--cyan))}
  .stat-card .label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600}
  .stat-card .value{font-size:22px;font-weight:800}
  .stat-card .sub{font-size:11px;color:var(--muted);margin-top:2px}
  .charts-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;margin-bottom:24px}
  @media(max-width:1000px){.charts-grid{grid-template-columns:1fr}}
  .chart-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
  .chart-card h3{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:.08em}
  .chart-wrap{position:relative}
  .chart-wrap.tall{height:220px}
  .chart-wrap.medium{height:200px}
  .table-section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px}
  .table-section h3{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:.08em}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;border-bottom:1px solid var(--border);font-weight:700}
  td{padding:8px 8px;font-size:13px;border-bottom:1px solid var(--border)}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(43,126,161,.06)}
  .model-tag{background:rgba(43,126,161,.15);color:var(--cyan2);padding:2px 8px;border-radius:99px;font-size:11px;white-space:nowrap;font-weight:600}
  .cost-ok{color:var(--green);font-weight:700}
  .na{color:var(--muted)}
  .loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--muted)}
  .err-msg{background:rgba(213,32,80,.1);border:1px solid var(--accent);border-radius:8px;padding:12px 16px;color:var(--accent);margin-bottom:16px}
  footer{text-align:center;color:var(--muted);font-size:11px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}
`;

function buildScript(apiBase: string): string {
  return `
const API='${apiBase}';
const MC=['#d52050','#3ea1cc','#212a45','#e02c5c','#2b7ea1','#1a2137','#8e1535','#226581','#e8607a','#4e9ad0'];
const TC={input:'rgba(62,161,204,0.85)',output:'rgba(213,32,80,0.85)',cache_read:'rgba(62,161,204,0.4)',cache_creation:'rgba(213,32,80,0.35)'};
const PR={'opus-4-6':{input:5,output:25,cacheRead:.5,cacheWrite:6.25},'opus-4-5':{input:5,output:25,cacheRead:.5,cacheWrite:6.25},'opus-4-1':{input:15,output:75,cacheRead:1.5,cacheWrite:18.75},opus:{input:5,output:25,cacheRead:.5,cacheWrite:6.25},sonnet:{input:3,output:15,cacheRead:.3,cacheWrite:3.75},'haiku-4':{input:1,output:5,cacheRead:.1,cacheWrite:1.25},'haiku-3':{input:.8,output:4,cacheRead:.08,cacheWrite:1},haiku:{input:1,output:5,cacheRead:.1,cacheWrite:1.25}};
function tier(m){const l=m.toLowerCase();if(l.includes('opus')){if(l.includes('4-1'))return'opus-4-1';if(l.includes('4-5'))return'opus-4-5';if(l.includes('4-6'))return'opus-4-6';return'opus'}if(l.includes('sonnet'))return'sonnet';if(l.includes('haiku')){if(l.includes('-3'))return'haiku-3';return'haiku-4'}return null}
/* Coût utile = input + output seulement (cache inclus dans Pro/Max) */
function cost(m,i,o){const t=tier(m);if(!t)return null;const p=PR[t];return(i*p.input+o*p.output)/1e6}
/* Coût API complet = avec cache, pour info */
function costFull(m,i,o,cr,cc){const t=tier(m);if(!t)return null;const p=PR[t];return(i*p.input+o*p.output+cr*p.cacheRead+cc*p.cacheWrite)/1e6}
function fmtT(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return''+n}
function fmtC(c){if(c===null||c===undefined)return'<span class=na>n/a</span>';if(c<.01)return'<span class=cost-ok>&lt;$0.01</span>';return'<span class=cost-ok>$'+c.toFixed(2)+'</span>'}
function fmtD(m){if(m<1)return'<1min';if(m<60)return Math.round(m)+'min';return(m/60).toFixed(1)+'h'}
let allData=null,selRange='7d',selModels=new Set(),charts={};
const params=new URLSearchParams(location.search);
if(params.get('range'))selRange=params.get('range');
if(params.get('models'))params.get('models').split(',').forEach(m=>selModels.add(m));
async function loadData(){
  try{
    const r=await fetch(API+'/api/data');
    if(!r.ok)throw new Error('HTTP '+r.status);
    allData=await r.json();
    document.getElementById('err').style.display='none';
    if(selModels.size===0){allData.all_models.forEach(m=>{if(tier(m))selModels.add(m)});if(selModels.size===0)allData.all_models.forEach(m=>selModels.add(m))}
    renderAll();
    document.getElementById('updated').textContent='Mis à jour '+allData.generated_at;
  }catch(e){const b=document.getElementById('err');b.style.display='block';b.textContent='Erreur: '+e.message}
}
function localDateStr(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
function cutoff(r){const n=new Date();if(r==='today')return localDateStr(n);if(r==='7d')return localDateStr(new Date(n-7*864e5));if(r==='30d')return localDateStr(new Date(n-30*864e5));if(r==='90d')return localDateStr(new Date(n-90*864e5));return null}
function fltDaily(rows){const c=cutoff(selRange);return rows.filter(r=>selModels.has(r.model)&&(!c||r.day>=c))}
function fltSess(s){const c=cutoff(selRange);return s.filter(x=>selModels.has(x.model)&&(!c||x.last_date>=c))}
function renderAll(){if(!allData)return;renderRanges();renderPills();renderStats();renderDaily();renderModelChart();renderProjects();renderSessions();renderCosts();syncUrl()}
function renderRanges(){document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b.dataset.range===selRange))}
function renderPills(){
  const el=document.getElementById('pills');
  while(el.firstChild)el.removeChild(el.firstChild);
  allData.all_models.forEach((m,i)=>{
    const color=MC[i%MC.length],active=selModels.has(m);
    const pill=document.createElement('label');
    pill.className='model-pill'+(active?' active':'');
    const dot=document.createElement('span');dot.className='dot';dot.style.background=color;
    pill.appendChild(dot);pill.appendChild(document.createTextNode(m));
    pill.onclick=()=>{if(selModels.has(m)){if(selModels.size>1)selModels.delete(m)}else selModels.add(m);renderAll()};
    el.appendChild(pill);
  });
}
const MAX_PRICE=100; /* Abonnement Claude Max $/mois */
function renderStats(){
  /* Use daily_by_model (already date-filtered) for accurate token/turn counts.
     sessions_all spans full session lifetime, so filtering by last_date over-counts
     turns from days outside the selected range. */
  const rows=fltDaily(allData.daily_by_model);
  let inp=0,out=0,cr=0,cc=0,turns=0,valFull=0,valUseful=0;
  rows.forEach(r=>{
    inp+=r.input;out+=r.output;cr+=r.cache_read;cc+=r.cache_creation;turns+=r.turns;
    const cf=costFull(r.model,r.input,r.output,r.cache_read,r.cache_creation);
    const cu=cost(r.model,r.input,r.output);
    if(cf!==null)valFull+=cf;
    if(cu!==null)valUseful+=cu;
  });
  /* Session count still comes from sessions_all (count of distinct sessions active in period) */
  const ss=fltSess(allData.sessions_all);
  const savings=valFull-MAX_PRICE;
  const savingsStr=savings>0?'<span style="color:var(--green)">+$'+savings.toFixed(2)+'</span>':'<span style="color:var(--muted)">$'+savings.toFixed(2)+'</span>';
  const g=document.getElementById('stats');
  g.innerHTML=[
    st('Sessions',ss.length,''),
    st('Turns',turns,''),
    st('Input',fmtT(inp),'tokens'),
    st('Output',fmtT(out),'tokens'),
    st('Cache Read',fmtT(cr),'inclus Max'),
    st('Valeur API','$'+valFull.toFixed(2),'avec cache'),
    st('Sans cache','$'+valUseful.toFixed(2),'input+output'),
    stHtml('Économies vs Max',savingsStr,'vs $'+MAX_PRICE+'/mois'),
  ].join('');
}
function st(l,v,s){return'<div class=stat-card><div class=label>'+l+'</div><div class=value>'+v+'</div>'+(s?'<div class=sub>'+s+'</div>':'')+'</div>'}
function stHtml(l,v,s){return'<div class=stat-card><div class=label>'+l+'</div><div class=value>'+v+'</div>'+(s?'<div class=sub>'+s+'</div>':'')+'</div>'}
function renderDaily(){
  const rows=fltDaily(allData.daily_by_model);
  const dm={};rows.forEach(r=>{if(!dm[r.day])dm[r.day]={input:0,output:0,cache_read:0,cache_creation:0};dm[r.day].input+=r.input;dm[r.day].output+=r.output;dm[r.day].cache_read+=r.cache_read;dm[r.day].cache_creation+=r.cache_creation});
  const labels=Object.keys(dm).sort();
  if(charts.daily)charts.daily.destroy();
  charts.daily=new Chart(document.getElementById('cDaily').getContext('2d'),{type:'bar',data:{labels,datasets:[
    {label:'Input',data:labels.map(d=>dm[d].input),backgroundColor:TC.input,stack:'t'},
    {label:'Output',data:labels.map(d=>dm[d].output),backgroundColor:TC.output,stack:'t'},
    {label:'Cache Read',data:labels.map(d=>dm[d].cache_read),backgroundColor:TC.cache_read,stack:'t'},
    {label:'Cache Write',data:labels.map(d=>dm[d].cache_creation),backgroundColor:TC.cache_creation,stack:'t'},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a3a88f',font:{size:11}}}},scales:{x:{ticks:{color:'#a3a88f',font:{size:10},maxTicksLimit:15},grid:{color:'rgba(255,255,255,.04)'}},y:{ticks:{color:'#a3a88f',font:{size:10},callback:v=>fmtT(v)},grid:{color:'rgba(255,255,255,.04)'}}}}});
}
function renderModelChart(){
  const rows=fltDaily(allData.daily_by_model);const mm={};
  rows.forEach(r=>{mm[r.model]=(mm[r.model]||0)+r.input+r.output});
  const labels=Object.keys(mm),vals=labels.map(m=>mm[m]),colors=labels.map((_,i)=>MC[i%MC.length]);
  if(charts.model)charts.model.destroy();
  charts.model=new Chart(document.getElementById('cModel').getContext('2d'),{type:'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:colors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#a3a88f',font:{size:10},padding:8}},tooltip:{callbacks:{label:ctx=>ctx.label+': '+fmtT(ctx.raw)}}}}});
}
function renderProjects(){
  const ss=fltSess(allData.sessions_all);const pm={};
  ss.forEach(s=>{pm[s.project]=(pm[s.project]||0)+s.input+s.output});
  const sorted=Object.entries(pm).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const labels=sorted.map(([p])=>p.split('/').pop()||p),vals=sorted.map(([,v])=>v);
  if(charts.proj)charts.proj.destroy();
  charts.proj=new Chart(document.getElementById('cProj').getContext('2d'),{type:'bar',data:{labels,datasets:[{data:vals,backgroundColor:'#3397c1',borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>fmtT(ctx.raw)}}},scales:{x:{ticks:{color:'#a3a88f',font:{size:10},callback:v=>fmtT(v)},grid:{color:'rgba(255,255,255,.04)'}},y:{ticks:{color:'#f1f2eb',font:{size:10}},grid:{display:false}}}}});
}
function renderSessions(){
  const ss=fltSess(allData.sessions_all).slice(0,20);
  const el=document.getElementById('tSess');
  if(!ss.length){el.textContent='Aucune session';return}
  const t=document.createElement('table');
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Session','Projet','Dernière activité','Durée','Modèle','Turns','Input','Output','Cache Read','Valeur API','Sans cache'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  ss.forEach(s=>{
    const r=tb.insertRow();
    // session_id
    const td0=r.insertCell();td0.textContent=s.session_id;td0.style.cssText='font-family:monospace;font-size:11px;color:var(--muted)';
    r.insertCell().textContent=s.project||'—';
    r.insertCell().textContent=s.last;
    r.insertCell().textContent=fmtD(s.duration_min);
    const tdm=r.insertCell();const sp=document.createElement('span');sp.className='model-tag';sp.textContent=s.model;tdm.appendChild(sp);
    r.insertCell().textContent=String(s.turns);
    r.insertCell().textContent=fmtT(s.input);
    r.insertCell().textContent=fmtT(s.output);
    r.insertCell().textContent=fmtT(s.cache_read);
    r.insertCell().innerHTML=fmtCost(costFull(s.model,s.input,s.output,s.cache_read,s.cache_creation));
    r.insertCell().innerHTML='<span style="color:var(--muted);font-size:11px">'+fmtC(cost(s.model,s.input,s.output))+'</span>';
  });
  while(el.firstChild)el.removeChild(el.firstChild);
  el.appendChild(t);
}
function fmtCost(c){if(c===null||c===undefined)return'<span class=na>n/a</span>';if(c<.01)return'<span class=cost-ok>&lt;$0.01</span>';return'<span class=cost-ok>$'+c.toFixed(2)+'</span>'}
function renderCosts(){
  const rows=fltDaily(allData.daily_by_model);const mm={};
  rows.forEach(r=>{if(!mm[r.model])mm[r.model]={input:0,output:0,cr:0,cc:0,turns:0};mm[r.model].input+=r.input;mm[r.model].output+=r.output;mm[r.model].cr+=r.cache_read;mm[r.model].cc+=r.cache_creation;mm[r.model].turns+=r.turns});
  const el=document.getElementById('tCosts');
  const models=Object.keys(mm);if(!models.length){el.textContent='Aucune donnée';return}
  let total=0;
  const t=document.createElement('table');
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Modèle','Turns','Input','Output','Cache Read','Cache Write','Valeur API','Sans cache'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  let totalUseful=0;
  models.forEach(m=>{
    const d=mm[m];
    const cf=costFull(m,d.input,d.output,d.cr,d.cc);
    const cu=cost(m,d.input,d.output);
    if(cf!==null)total+=cf;
    if(cu!==null)totalUseful+=cu;
    const r=tb.insertRow();
    const sp=document.createElement('span');sp.className='model-tag';sp.textContent=m;
    r.insertCell().appendChild(sp);
    [d.turns,fmtT(d.input),fmtT(d.output),fmtT(d.cr),fmtT(d.cc)].forEach(v=>{r.insertCell().textContent=String(v)});
    r.insertCell().innerHTML=fmtCost(cf);
    r.insertCell().innerHTML='<span style="color:var(--muted);font-size:11px">'+fmtC(cu)+'</span>';
  });
  // Total row
  const tr=tb.insertRow();tr.style.fontWeight='700';tr.style.borderTop='2px solid var(--border)';
  tr.insertCell().textContent='Total';
  for(let i=0;i<5;i++)tr.insertCell();
  tr.insertCell().innerHTML=fmtCost(total);
  tr.insertCell().innerHTML='<span style="color:var(--muted);font-size:11px">'+fmtC(totalUseful)+'</span>';
  // Savings row
  const savings=total-MAX_PRICE;
  const ts=tb.insertRow();ts.style.borderTop='1px solid var(--border)';
  const tsd=ts.insertCell();tsd.colSpan=6;tsd.style.cssText='color:var(--muted);font-size:12px;padding-top:10px';
  tsd.textContent='Économies vs abonnement Max ($'+MAX_PRICE+'/mois) :';
  const tsv=ts.insertCell();tsv.colSpan=2;tsv.style.cssText='font-weight:700;padding-top:10px;font-size:15px';
  tsv.innerHTML=savings>0?'<span style="color:var(--green)">+$'+savings.toFixed(2)+'</span>':'<span style="color:var(--muted)">$'+savings.toFixed(2)+'</span>';
  while(el.firstChild)el.removeChild(el.firstChild);
  el.appendChild(t);
}
function syncUrl(){const p=new URLSearchParams();p.set('range',selRange);p.set('models',[...selModels].join(','));history.replaceState(null,'','?'+p.toString())}
document.getElementById('ranges').addEventListener('click',e=>{const b=e.target.closest('.range-btn');if(!b)return;selRange=b.dataset.range;renderAll()});
loadData();setInterval(loadData,30000);
let secs=30;const ref=document.getElementById('ref');
setInterval(()=>{secs--;if(secs<=0)secs=30;ref.textContent=' · Refresh dans '+secs+'s'},1000);
  `;
}

export function getDashboardHtml(apiBase: string): string {
  const script = buildScript(apiBase);
  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Nova Stellaris MCP — Usage Dashboard</title>',
    `<script src="${CHARTJS_CDN}"></script>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<div class="container">',
    '  <header>',
    '    <h1><span class="brand">Nova Stellaris MCP</span><span class="sep">:</span>Claude Code <span>Usage</span></h1>',
    '    <span class="badge" id="updated">Chargement…</span>',
    '  </header>',
    '  <div style="background:rgba(0,198,224,.08);border:1px solid rgba(0,198,224,.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--muted)">',
    '    <strong style="color:var(--cyan)">ℹ️ Valeur API</strong> — La colonne <em>Valeur API</em> affiche ce que coûterait ta consommation sur l\'API Anthropic (input + output + cache). Compare-la à ton abonnement Max ($100/mois) pour mesurer tes économies. <em>Sans cache</em> = tokens utiles uniquement.',
    '  </div>',
    '  <div id="err" class="err-msg" style="display:none"></div>',
    '  <div class="filters">',
    '    <div class="filter-group" id="ranges">',
    '      <button class="range-btn" data-range="today">Aujourd\'hui</button>',
    '      <button class="range-btn active" data-range="7d">7j</button>',
    '      <button class="range-btn" data-range="30d">30j</button>',
    '      <button class="range-btn" data-range="90d">90j</button>',
    '      <button class="range-btn" data-range="all">Tout</button>',
    '    </div>',
    '    <div id="pills" class="filter-group"></div>',
    '  </div>',
    '  <div class="stats-grid" id="stats"><div class="loading">Chargement…</div></div>',
    '  <div class="charts-grid">',
    '    <div class="chart-card"><h3>Tokens par jour</h3><div class="chart-wrap tall"><canvas id="cDaily"></canvas></div></div>',
    '    <div class="chart-card"><h3>Par modèle</h3><div class="chart-wrap medium"><canvas id="cModel"></canvas></div></div>',
    '    <div class="chart-card"><h3>Top projets</h3><div class="chart-wrap medium"><canvas id="cProj"></canvas></div></div>',
    '  </div>',
    '  <div class="table-section"><h3>Sessions récentes</h3><div id="tSess"><div class="loading">Chargement…</div></div></div>',
    '  <div class="table-section"><h3>Coûts par modèle</h3><div id="tCosts"><div class="loading">Chargement…</div></div></div>',
    '  <footer>Nova Stellaris MCP · Données locales · ~/.claude/usage.db · Prix API Anthropic (estimatifs)<span id="ref"></span></footer>',
    '</div>',
    `<script>${script}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
