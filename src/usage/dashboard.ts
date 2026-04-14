/**
 * Claude Code Usage Dashboard — HTML template
 * Single-page app with Chart.js. Dark theme, inline CSS+JS.
 * Data comes from our own local API (localhost SQLite) — no external user input.
 *
 * v2: tabbed layout (Overview / Cache / Anomalies), costs precomputed server-side.
 * The JS client no longer reimplements pricing — it uses cost_full/cost_useful from /api/data.
 *
 * Security note: all dynamic content inserted via textContent or number formatting
 * (fmtT, fmtC) whose output is a fixed-pattern string like "$1.23" or "1.5M".
 * The only innerHTML calls use output from those pure formatters, not raw DB strings.
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
    --green:#10b981;--yellow:#f59e0b;--red:#ef4444;--orange:#f97316;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Poppins',sans-serif;font-size:14px;line-height:1.5}
  h1,h2,h3{font-family:'Inter',sans-serif}
  .container{max-width:1400px;margin:0 auto;padding:24px}
  header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:16px}
  header h1{font-size:20px;font-weight:800;letter-spacing:-.01em}
  header h1 .brand{color:var(--cyan2)}
  header h1 .sep{color:var(--border);margin:0 6px}
  header h1 span{color:var(--accent)}
  .badge{background:var(--card2);border:1px solid var(--border);border-radius:99px;padding:4px 12px;font-size:12px;color:var(--muted);font-weight:600}
  .tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:0}
  .tab-btn{background:none;border:none;border-bottom:2px solid transparent;padding:8px 18px;cursor:pointer;color:var(--muted);font-size:13px;font-weight:600;font-family:'Poppins',sans-serif;transition:all .2s;margin-bottom:-1px}
  .tab-btn:hover{color:var(--text)}
  .tab-btn.active{color:var(--cyan2);border-bottom-color:var(--cyan2)}
  .tab-panel{display:none}.tab-panel.active{display:block}
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
  .cost-val{color:var(--green);font-weight:700}
  .na{color:var(--muted)}
  .rule-SES001{background:rgba(239,68,68,.15);color:var(--red);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
  .rule-SES002{background:rgba(249,115,22,.15);color:var(--orange);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
  .rule-SES003{background:rgba(245,158,11,.15);color:var(--yellow);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
  .rule-SES004{background:rgba(163,168,143,.15);color:var(--muted);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
  .hit-bar-wrap{display:flex;align-items:center;gap:8px}
  .hit-bar{height:6px;border-radius:3px;background:var(--border);flex:1;overflow:hidden}
  .hit-bar-fill{height:100%;border-radius:3px}
  .loading{display:flex;align-items:center;justify-content:center;height:200px;color:var(--muted)}
  .err-msg{background:rgba(213,32,80,.1);border:1px solid var(--accent);border-radius:8px;padding:12px 16px;color:var(--accent);margin-bottom:16px}
  .empty-state{color:var(--muted);font-size:13px;padding:24px;text-align:center}
  .info-banner{background:rgba(43,126,161,.08);border:1px solid rgba(43,126,161,.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--muted)}
  .info-banner strong{color:var(--cyan)}
  footer{text-align:center;color:var(--muted);font-size:11px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}
`;

function buildScript(apiBase: string): string {
  return `
const API='${apiBase}';
const MC=['#d52050','#3ea1cc','#212a45','#e02c5c','#2b7ea1','#1a2137','#8e1535','#226581','#e8607a','#4e9ad0'];
const TC={input:'rgba(62,161,204,0.85)',output:'rgba(213,32,80,0.85)',cache_read:'rgba(62,161,204,0.4)',cache_creation:'rgba(213,32,80,0.35)'};

/* Pure formatters — output is always a safe fixed-pattern string, never raw DB data */
function fmtT(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return''+Math.round(n)}
function fmtC(c){if(c===null||c===undefined||isNaN(c)||c===0)return null;return c<.01?'<$0.01':'$'+c.toFixed(2)}
function fmtD(m){if(m<1)return'<1min';if(m<60)return Math.round(m)+'min';return(m/60).toFixed(1)+'h'}
function fmtPct(r){return(r*100).toFixed(1)+'%'}

/* Static pricing constants for what-if calculator only ($/1M tokens, Anthropic April 2026) */
const RATES={
  opus:{input:5,output:25,cr:.5,cw:6.25},
  sonnet:{input:3,output:15,cr:.3,cw:3.75}
};
function calcCost(rate,inp,out,cr,cw){return(inp*rate.input+out*rate.output+cr*rate.cr+cw*rate.cw)/1e6}
function isOpus(m){return m&&m.toLowerCase().includes('opus')}
function isSonnet(m){return m&&m.toLowerCase().includes('sonnet')}

/* Set text on a td, with optional CSS color class */
function setTd(td,text,cls){td.textContent=text||'—';if(cls)td.className=cls;}

let allData=null,selRange='7d',selModels=new Set(),charts={},activeTab='overview';
const params=new URLSearchParams(location.search);
if(params.get('range'))selRange=params.get('range');
if(params.get('models'))params.get('models').split(',').forEach(m=>selModels.add(m));
if(params.get('tab'))activeTab=params.get('tab');

async function loadData(){
  try{
    const r=await fetch(API+'/api/data');
    if(!r.ok)throw new Error('HTTP '+r.status);
    allData=await r.json();
    document.getElementById('err').style.display='none';
    if(selModels.size===0)allData.all_models.forEach(m=>selModels.add(m));
    renderAll();
    document.getElementById('updated').textContent='Mis a jour '+allData.generated_at;
  }catch(e){const b=document.getElementById('err');b.style.display='block';b.textContent='Erreur: '+e.message}
}

function localDateStr(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
function cutoff(r){const n=new Date();if(r==='today')return localDateStr(n);if(r==='7d')return localDateStr(new Date(n-7*864e5));if(r==='30d')return localDateStr(new Date(n-30*864e5));if(r==='90d')return localDateStr(new Date(n-90*864e5));return null}
function fltDaily(rows){const c=cutoff(selRange);return rows.filter(r=>selModels.has(r.model)&&(!c||r.day>=c))}
function fltSess(s){const c=cutoff(selRange);return s.filter(x=>selModels.has(x.model)&&(!c||x.last_date>=c))}

function renderAll(){
  if(!allData)return;
  renderTabs();renderRanges();renderPills();
  renderStats();renderDaily();renderModelChart();renderProjects();renderSessions();renderCosts();
  renderCache();renderAnomalies();renderBreakdown();
  syncUrl();
}
function renderTabs(){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+activeTab));
}
function renderRanges(){document.querySelectorAll('.range-btn').forEach(b=>b.classList.toggle('active',b.dataset.range===selRange))}
function renderPills(){
  const el=document.getElementById('pills');
  while(el.firstChild)el.removeChild(el.firstChild);
  allData.all_models.forEach((m,i)=>{
    const active=selModels.has(m);
    const pill=document.createElement('label');
    pill.className='model-pill'+(active?' active':'');
    const dot=document.createElement('span');dot.className='dot';dot.style.background=MC[i%MC.length];
    const txt=document.createTextNode(m);
    pill.appendChild(dot);pill.appendChild(txt);
    pill.onclick=()=>{if(selModels.has(m)){if(selModels.size>1)selModels.delete(m)}else selModels.add(m);renderAll()};
    el.appendChild(pill);
  });
}

/* Helper: create stat card element */
function mkCard(label,value,sub,valueColor){
  const card=document.createElement('div');card.className='stat-card';
  const lbl=document.createElement('div');lbl.className='label';lbl.textContent=label;
  const val=document.createElement('div');val.className='value';val.textContent=value;
  if(valueColor)val.style.color=valueColor;
  card.appendChild(lbl);card.appendChild(val);
  if(sub){const s=document.createElement('div');s.className='sub';s.textContent=sub;card.appendChild(s)}
  return card;
}

/* Helper: cost cell — uses textContent, never raw strings from DB */
function addCostCell(row,cost,muted){
  const td=row.insertCell();
  const formatted=fmtC(cost);
  if(formatted===null){td.textContent='n/a';td.className='na';return}
  const sp=document.createElement('span');
  sp.className=muted?'na':'cost-val';
  sp.textContent=formatted;
  td.appendChild(sp);
}

/* ── Overview tab ── */
function renderStats(){
  const rows=fltDaily(allData.daily_by_model);
  let inp=0,out=0,cr=0,cc=0,turns=0;
  rows.forEach(r=>{inp+=r.input;out+=r.output;cr+=r.cache_read;cc+=r.cache_creation;turns+=r.turns});
  const ss=fltSess(allData.sessions_all);
  let valFull=0,valUseful=0;
  ss.forEach(s=>{valFull+=(s.cost_full||0);valUseful+=(s.cost_useful||0)});
  const MAX_PRICE=allData.max_price_monthly||100;
  const savings=valFull-MAX_PRICE;
  const g=document.getElementById('stats');
  while(g.firstChild)g.removeChild(g.firstChild);
  g.appendChild(mkCard('Sessions',String(ss.length),''));
  g.appendChild(mkCard('Turns',String(turns),''));
  g.appendChild(mkCard('Input',fmtT(inp),'tokens'));
  g.appendChild(mkCard('Output',fmtT(out),'tokens'));
  g.appendChild(mkCard('Cache Read',fmtT(cr),'inclus Max'));
  g.appendChild(mkCard('Valeur API',fmtC(valFull)||'$0.00','avec cache'));
  g.appendChild(mkCard('Sans cache',fmtC(valUseful)||'$0.00','input+output'));
  g.appendChild(mkCard('Economies vs Max',(savings>0?'+':'')+((savings>0?savings:-savings)<.01?'<$0.01':'$'+Math.abs(savings).toFixed(2)),'vs $'+MAX_PRICE+'/mois',savings>0?'var(--green)':'var(--muted)'));
}

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
  while(el.firstChild)el.removeChild(el.firstChild);
  if(!ss.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Aucune session dans cette periode';el.appendChild(d);return}
  const t=document.createElement('table');
  ['Session','Projet','Derniere activite','Duree','Modele','Turns','Input','Output','Cache Read','Valeur API','Sans cache'].forEach(h=>{const th=t.createTHead().insertRow().insertCell();th.textContent=h;});
  /* rebuild header properly */
  t.deleteTHead();
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Session','Projet','Derniere activite','Duree','Modele','Turns','Input','Output','Cache Read','Valeur API','Sans cache'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  ss.forEach(s=>{
    const r=tb.insertRow();
    const td0=r.insertCell();td0.textContent=s.session_id;td0.style.cssText='font-family:monospace;font-size:11px;color:var(--muted)';
    r.insertCell().textContent=s.project||'—';
    r.insertCell().textContent=s.last||'—';
    r.insertCell().textContent=fmtD(s.duration_min||0);
    const tdm=r.insertCell();const sp=document.createElement('span');sp.className='model-tag';sp.textContent=s.model||'—';tdm.appendChild(sp);
    r.insertCell().textContent=String(s.turns||0);
    r.insertCell().textContent=fmtT(s.input||0);
    r.insertCell().textContent=fmtT(s.output||0);
    r.insertCell().textContent=fmtT(s.cache_read||0);
    addCostCell(r,s.cost_full,false);
    addCostCell(r,s.cost_useful,true);
  });
  el.appendChild(t);
}
function renderCosts(){
  const mc=allData.model_costs||[];
  const el=document.getElementById('tCosts');
  while(el.firstChild)el.removeChild(el.firstChild);
  if(!mc.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Aucune donnee';el.appendChild(d);return}
  const t=document.createElement('table');
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Modele','Turns','Input','Output','Cache Read','Cache Write','Valeur API','Sans cache'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  let totalFull=0,totalUseful=0;
  mc.forEach(m=>{
    totalFull+=(m.cost_full||0);totalUseful+=(m.cost_useful||0);
    const r=tb.insertRow();
    const sp=document.createElement('span');sp.className='model-tag';sp.textContent=m.model;r.insertCell().appendChild(sp);
    [m.turns,fmtT(m.input),fmtT(m.output),fmtT(m.cache_read),fmtT(m.cache_creation)].forEach(v=>{r.insertCell().textContent=String(v)});
    addCostCell(r,m.cost_full,false);
    addCostCell(r,m.cost_useful,true);
  });
  const tr=tb.insertRow();tr.style.fontWeight='700';tr.style.borderTop='2px solid var(--border)';
  tr.insertCell().textContent='Total';
  for(let i=0;i<5;i++)tr.insertCell();
  addCostCell(tr,totalFull,false);
  addCostCell(tr,totalUseful,true);
  const MAX_PRICE=allData.max_price_monthly||100;
  const savings=totalFull-MAX_PRICE;
  const ts=tb.insertRow();ts.style.borderTop='1px solid var(--border)';
  const tsd=ts.insertCell();tsd.colSpan=6;tsd.style.cssText='color:var(--muted);font-size:12px;padding-top:10px';
  tsd.textContent='Economies vs abonnement Max ($'+MAX_PRICE+'/mois) :';
  const tsv=ts.insertCell();tsv.colSpan=2;tsv.style.cssText='font-weight:700;padding-top:10px;font-size:15px';
  const savSpan=document.createElement('span');
  savSpan.style.color=savings>0?'var(--green)':'var(--muted)';
  savSpan.textContent=(savings>0?'+':'')+fmtC(Math.abs(savings));
  tsv.appendChild(savSpan);
  el.appendChild(t);
}

/* ── Cache tab ── */
function renderCache(){
  const cs=allData.cache_stats||[];
  const el=document.getElementById('tCache');
  while(el.firstChild)el.removeChild(el.firstChild);
  if(!cs.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Pas encore de donnees de cache';el.appendChild(d);return}
  const t=document.createElement('table');
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Modele','Input','Cache Read','Cache Write','Hit Ratio','Efficacite'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  cs.forEach(r=>{
    const row=tb.insertRow();
    const sp=document.createElement('span');sp.className='model-tag';sp.textContent=r.model;row.insertCell().appendChild(sp);
    row.insertCell().textContent=fmtT(r.total_input||0);
    row.insertCell().textContent=fmtT(r.total_cache_read||0);
    row.insertCell().textContent=fmtT(r.total_cache_creation||0);
    /* Hit ratio mini-bar — built purely from numbers, no DB strings */
    const ratio=r.hit_ratio||0;
    const barColor=ratio>=0.7?'var(--green)':ratio>=0.4?'var(--yellow)':'var(--red)';
    const tdRatio=row.insertCell();
    const wrap=document.createElement('div');wrap.className='hit-bar-wrap';
    const bar=document.createElement('div');bar.className='hit-bar';
    const fill=document.createElement('div');fill.className='hit-bar-fill';
    fill.style.width=Math.round(ratio*100)+'%';fill.style.background=barColor;
    bar.appendChild(fill);
    const pctSpan=document.createElement('span');pctSpan.textContent=fmtPct(ratio);
    wrap.appendChild(bar);wrap.appendChild(pctSpan);
    tdRatio.appendChild(wrap);
    const effMap={0:'🔴 Faible',40:'🟡 Moyen',70:'🟢 Excellent'};
    const effKey=ratio>=0.7?70:ratio>=0.4?40:0;
    row.insertCell().textContent=effMap[effKey];
  });
  el.appendChild(t);

  /* Cache donut — segments = cache_read tokens par modèle, couleurs distinctes par modèle */
  const MODEL_PALETTE=['#3b82f6','#f97316','#a78bfa','#22c55e','#ec4899','#06b6d4','#eab308','#ef4444'];
  const cacheLabels=cs.map(r=>r.model);
  const cacheVals=cs.map(r=>r.total_cache_read||0);
  const cacheColors=cs.map((_,i)=>MODEL_PALETTE[i%MODEL_PALETTE.length]);
  const cacheHits=cs.map(r=>Math.round((r.hit_ratio||0)*100));
  if(charts.cacheDonut)charts.cacheDonut.destroy();
  const ctx=document.getElementById('cCacheDonut');
  if(ctx&&cacheLabels.length){
    charts.cacheDonut=new Chart(ctx.getContext('2d'),{
      type:'doughnut',
      data:{labels:cacheLabels,datasets:[{data:cacheVals,backgroundColor:cacheColors,borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#a3a88f',font:{size:10},padding:8,generateLabels:chart=>{const ds=chart.data.datasets[0];return chart.data.labels.map((lbl,i)=>({text:lbl+' — hit '+cacheHits[i]+'%',fillStyle:ds.backgroundColor[i],strokeStyle:'transparent',fontColor:'#c9cfc1',index:i}));}}},tooltip:{callbacks:{label:ctx=>{const i=ctx.dataIndex;return [ctx.label+' : '+fmtT(ctx.raw)+' cache read','Hit ratio : '+cacheHits[i]+'%'];}}}}}
    });
  }

  renderWhatIf();
}

/* ── What-if Opus → Sonnet calculator ── */
function renderWhatIf(){
  const mc=allData.model_costs||[];
  /* Aggregate all Opus rows */
  let opusInp=0,opusOut=0,opusCr=0,opusCw=0,opusTurns=0;
  mc.forEach(r=>{
    if(isOpus(r.model)){
      opusInp+=r.input||0;opusOut+=r.output||0;
      opusCr+=r.cache_read||0;opusCw+=r.cache_creation||0;
      opusTurns+=r.turns||0;
    }
  });
  const section=document.getElementById('whatif-section');
  if(!opusTurns||opusInp+opusOut===0){section.style.display='none';return}
  section.style.display='block';

  const actualCost=calcCost(RATES.opus,opusInp,opusOut,opusCr,opusCw);
  const hypoCost=calcCost(RATES.sonnet,opusInp,opusOut,opusCr,opusCw);
  const savings=actualCost-hypoCost;

  document.getElementById('wi-actual').textContent=fmtC(actualCost)||'$0.00';
  document.getElementById('wi-actual-sub').textContent=opusTurns+' turns Opus - '+fmtT(opusInp+opusOut)+' tokens';
  document.getElementById('wi-hypo').textContent=fmtC(hypoCost)||'$0.00';
  document.getElementById('wi-hypo-sub').textContent='Memes volumes, tarif Sonnet 4.6';
  document.getElementById('wi-savings').textContent=(savings>0?'+':'')+fmtC(savings);
  /* Color savings banner */
  const banner=document.getElementById('wi-savings-banner');
  banner.style.background=savings>0?'rgba(16,185,129,.1)':'rgba(163,168,143,.1)';
  banner.style.borderColor=savings>0?'rgba(16,185,129,.3)':'rgba(163,168,143,.3)';
  document.getElementById('wi-savings').style.color=savings>0?'var(--green)':'var(--muted)';
}

/* ── Anomalies tab ── */
const RULE_LABELS={SES001:'Cout eleve',SES002:'Trop de messages',SES003:'Trop de tokens',SES004:'Session idle'};
const RULE_ICONS={SES001:'💸',SES002:'💬',SES003:'📦',SES004:'💤'};
function renderAnomalies(){
  const an=allData.anomalies||[];
  const el=document.getElementById('tAnomalies');
  const badge=document.getElementById('anomaly-count');
  if(badge)badge.textContent=an.length?String(an.length):'';
  while(el.firstChild)el.removeChild(el.firstChild);
  if(!an.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Aucune session anormale detectee';el.appendChild(d);return}
  const t=document.createElement('table');
  const thead=t.createTHead();const hr=thead.insertRow();
  ['Regle','Session','Projet','Modele','Turns','Derniere activite','Detail'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
  const tb=t.createTBody();
  an.forEach(a=>{
    const r=tb.insertRow();
    const ruleSp=document.createElement('span');ruleSp.className='rule-'+a.rule;
    ruleSp.textContent=(RULE_ICONS[a.rule]||'')+' '+(RULE_LABELS[a.rule]||a.rule);
    r.insertCell().appendChild(ruleSp);
    const td=r.insertCell();td.textContent=(a.session_id||'').substring(0,8);td.style.cssText='font-family:monospace;font-size:11px;color:var(--muted)';
    r.insertCell().textContent=a.project_name||'—';
    const sp=document.createElement('span');sp.className='model-tag';sp.textContent=a.model||'—';r.insertCell().appendChild(sp);
    r.insertCell().textContent=String(a.turn_count||0);
    r.insertCell().textContent=(a.last_timestamp||'').replace('T',' ').substring(0,16)||'—';
    r.insertCell().textContent=a.detail||'—';
  });
  el.appendChild(t);
}

/* ── Breakdown tab ── */
const CAT_COLORS={coding:'#3b82f6',debugging:'#ef4444',feature:'#22c55e',refactoring:'#f97316',testing:'#8b5cf6',exploration:'#06b6d4',planning:'#eab308',delegation:'#ec4899',git:'#6b7280',build_deploy:'#f59e0b',conversation:'#94a3b8',brainstorming:'#a78bfa',general:'#64748b'};
const CAT_LABELS={coding:'Coding',debugging:'Debugging',feature:'Feature Dev',refactoring:'Refactoring',testing:'Testing',exploration:'Exploration',planning:'Planning',delegation:'Delegation',git:'Git Ops',build_deploy:'Build/Deploy',conversation:'Conversation',brainstorming:'Brainstorming',general:'General'};
const CAT_ICONS={coding:'💻',debugging:'🐛',feature:'✨',refactoring:'♻️',testing:'🧪',exploration:'🔍',planning:'📋',delegation:'🤖',git:'🌿',build_deploy:'🚀',conversation:'💬',brainstorming:'🧠',general:'📌'};

function renderBreakdown(){
  const cats=allData.category_breakdown||[];
  const mcps=allData.mcp_breakdown||[];
  const tools=allData.core_tool_breakdown||[];

  /* Category donut */
  if(charts.catDonut)charts.catDonut.destroy();
  const ctxCat=document.getElementById('cCatDonut');
  if(ctxCat&&cats.length){
    const labels=cats.map(r=>(CAT_ICONS[r.category]||'📌')+' '+(CAT_LABELS[r.category]||r.category));
    const vals=cats.map(r=>r.turn_count);
    const colors=cats.map(r=>CAT_COLORS[r.category]||'#64748b');
    charts.catDonut=new Chart(ctxCat.getContext('2d'),{
      type:'doughnut',
      data:{labels,datasets:[{data:vals,backgroundColor:colors,borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'right',labels:{color:'#c9cfc1',font:{size:11},padding:10,boxWidth:14,generateLabels:chart=>{const ds=chart.data.datasets[0];return chart.data.labels.map((lbl,i)=>({text:lbl+' ('+ds.data[i]+')',fillStyle:ds.backgroundColor[i],strokeStyle:'transparent',fontColor:'#c9cfc1',index:i}));}}},tooltip:{callbacks:{label:ctx=>ctx.label+': '+ctx.raw+' turns'}}}}
    });
  }

  /* Category table */
  const elCat=document.getElementById('tCategories');
  while(elCat.firstChild)elCat.removeChild(elCat.firstChild);
  if(!cats.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Pas encore de donnees (rescan en cours...)';elCat.appendChild(d);}
  else{
    const totalTurns=cats.reduce((s,r)=>s+r.turn_count,0);
    const totalTok=cats.reduce((s,r)=>s+r.total_input+r.total_output,0);
    const t=document.createElement('table');
    const thead=t.createTHead();const hr=thead.insertRow();
    ['Categorie','Turns','%','Tokens','%'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
    const tb=t.createTBody();
    cats.forEach(r=>{
      const row=tb.insertRow();
      const icon=CAT_ICONS[r.category]||'📌';
      const label=CAT_LABELS[r.category]||r.category;
      const color=CAT_COLORS[r.category]||'#64748b';
      const td0=row.insertCell();
      const sp=document.createElement('span');sp.style.cssText='display:inline-flex;align-items:center;gap:6px';
      const dot=document.createElement('span');dot.style.cssText='width:8px;height:8px;border-radius:50%;background:'+color+';flex-shrink:0;display:inline-block';
      const txt=document.createTextNode(icon+' '+label);
      sp.appendChild(dot);sp.appendChild(txt);td0.appendChild(sp);
      row.insertCell().textContent=String(r.turn_count);
      const pct=totalTurns>0?((r.turn_count/totalTurns)*100).toFixed(0)+'%':'—';
      row.insertCell().textContent=pct;
      const tok=r.total_input+(r.total_output||0);
      row.insertCell().textContent=fmtT(tok);
      const pctTok=totalTok>0?((tok/totalTok)*100).toFixed(0)+'%':'—';
      row.insertCell().textContent=pctTok;
    });
    elCat.appendChild(t);
  }

  /* MCP bar chart */
  if(charts.mcpBar)charts.mcpBar.destroy();
  const ctxMcp=document.getElementById('cMcpBar');
  if(ctxMcp&&mcps.length){
    const top12=mcps.slice(0,12);
    charts.mcpBar=new Chart(ctxMcp.getContext('2d'),{
      type:'bar',
      data:{labels:top12.map(r=>r.server),datasets:[{label:'Appels',data:top12.map(r=>r.call_count),backgroundColor:'rgba(62,161,204,0.8)',borderRadius:3}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.raw+' appels'}}},scales:{x:{ticks:{color:'#a3a88f',font:{size:10}},grid:{color:'rgba(255,255,255,.04)'}},y:{ticks:{color:'#f1f2eb',font:{size:10}},grid:{display:false}}}}
    });
  } else if(ctxMcp&&!mcps.length){
    const el=document.getElementById('mcp-empty');if(el)el.style.display='block';
  }

  /* Core tools table */
  const elTools=document.getElementById('tCoreTools');
  while(elTools.firstChild)elTools.removeChild(elTools.firstChild);
  if(!tools.length){const d=document.createElement('div');d.className='empty-state';d.textContent='Aucun outil detecte';elTools.appendChild(d);}
  else{
    const totalCalls=tools.reduce((s,r)=>s+r.call_count,0);
    const t=document.createElement('table');
    const thead=t.createTHead();const hr=thead.insertRow();
    ['Outil','Appels','%'].forEach(h=>{const th=document.createElement('th');th.textContent=h;hr.appendChild(th)});
    const tb=t.createTBody();
    tools.slice(0,15).forEach(r=>{
      const row=tb.insertRow();
      const td0=row.insertCell();td0.style.fontFamily='monospace';td0.style.fontSize='12px';td0.textContent=r.tool;
      row.insertCell().textContent=String(r.call_count);
      const pct=totalCalls>0?((r.call_count/totalCalls)*100).toFixed(0)+'%':'—';
      row.insertCell().textContent=pct;
    });
    elTools.appendChild(t);
  }
}

function syncUrl(){const p=new URLSearchParams();p.set('range',selRange);p.set('models',[...selModels].join(','));p.set('tab',activeTab);history.replaceState(null,'','?'+p.toString())}

document.getElementById('ranges').addEventListener('click',e=>{const b=e.target.closest('.range-btn');if(!b)return;selRange=b.dataset.range;renderAll()});
document.getElementById('tab-bar').addEventListener('click',e=>{const b=e.target.closest('.tab-btn');if(!b)return;activeTab=b.dataset.tab;renderAll()});

loadData();setInterval(loadData,30000);
let secs=30;const ref=document.getElementById('ref');
setInterval(()=>{secs--;if(secs<=0)secs=30;ref.textContent=' - Refresh dans '+secs+'s'},1000);
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
    '    <span class="badge" id="updated">Chargement...</span>',
    '  </header>',
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
    '  <div class="tabs" id="tab-bar">',
    '    <button class="tab-btn active" data-tab="overview">Vue d\'ensemble</button>',
    '    <button class="tab-btn" data-tab="cache">Cache</button>',
    '    <button class="tab-btn" data-tab="anomalies">Anomalies <span id="anomaly-count" style="background:rgba(239,68,68,.2);color:var(--red);border-radius:99px;padding:1px 7px;font-size:10px;margin-left:4px"></span></button>',
    '    <button class="tab-btn" data-tab="breakdown">Breakdown</button>',
    '  </div>',
    '  <div class="tab-panel active" id="tab-overview">',
    '    <div class="info-banner"><strong>Info Valeur API</strong> — Valeur API = cout Anthropic direct (input + output + cache). Sans cache = tokens utiles uniquement. Couts precalcules cote serveur.</div>',
    '    <div class="stats-grid" id="stats"><div class="loading">Chargement...</div></div>',
    '    <div class="charts-grid">',
    '      <div class="chart-card"><h3>Tokens par jour</h3><div class="chart-wrap tall"><canvas id="cDaily"></canvas></div></div>',
    '      <div class="chart-card"><h3>Par modele</h3><div class="chart-wrap medium"><canvas id="cModel"></canvas></div></div>',
    '      <div class="chart-card"><h3>Top projets</h3><div class="chart-wrap medium"><canvas id="cProj"></canvas></div></div>',
    '    </div>',
    '    <div class="table-section"><h3>Sessions recentes</h3><div id="tSess"><div class="loading">Chargement...</div></div></div>',
    '    <div class="table-section"><h3>Couts par modele (90 derniers jours)</h3><div id="tCosts"><div class="loading">Chargement...</div></div></div>',
    '  </div>',
    '  <div class="tab-panel" id="tab-cache">',
    '    <div class="info-banner"><strong>Hit Ratio</strong> — Proportion de tokens servis depuis le cache Anthropic. Un ratio eleve signifie que tes prompts exploitent bien le cache (instructions systeme en tete de message, TTL 5min ou 1h).</div>',
    '    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">',
    '      <div class="table-section" style="margin-bottom:0"><h3>Cache par modele</h3><div id="tCache"><div class="loading">Chargement...</div></div></div>',
    '      <div class="chart-card"><h3>Hit Ratio par modele</h3><div class="chart-wrap medium"><canvas id="cCacheDonut"></canvas></div></div>',
    '    </div>',
    '    <div id="whatif-section" style="display:none">',
    '      <div class="table-section">',
    '        <h3>What-if : Opus → Sonnet</h3>',
    '        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Si tes turns Opus avaient tourne en Sonnet 4.6, combien aurais-tu economise ?</p>',
    '        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">',
    '          <div class="chart-card" style="background:var(--card2)">',
    '            <h3>Cout reel (Opus)</h3>',
    '            <div id="wi-actual" style="font-size:28px;font-weight:800;color:var(--accent);margin:8px 0"></div>',
    '            <div id="wi-actual-sub" style="font-size:11px;color:var(--muted)"></div>',
    '          </div>',
    '          <div class="chart-card" style="background:var(--card2)">',
    '            <h3>Cout hypothetique (Sonnet)</h3>',
    '            <div id="wi-hypo" style="font-size:28px;font-weight:800;color:var(--cyan2);margin:8px 0"></div>',
    '            <div id="wi-hypo-sub" style="font-size:11px;color:var(--muted)"></div>',
    '          </div>',
    '        </div>',
    '        <div id="wi-savings-banner" style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:8px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">',
    '          <span style="font-size:13px;color:var(--muted)">Economie potentielle sur la periode</span>',
    '          <span id="wi-savings" style="font-size:24px;font-weight:800;color:var(--green)"></span>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="tab-panel" id="tab-anomalies">',
    '    <div class="info-banner"><strong>Session Health</strong> — Sessions anormales : SES001 cout estime &gt;= $25 | SES002 &gt;= 200 turns | SES003 &gt;= 5M tokens | SES004 idle 7j+ avec 50+ turns.</div>',
    '    <div class="table-section"><h3>Sessions anormales</h3><div id="tAnomalies"><div class="loading">Chargement...</div></div></div>',
    '  </div>',
    '  <div class="tab-panel" id="tab-breakdown">',
    '    <div class="info-banner"><strong>Breakdown</strong> — Ou partent tes tokens ? Classification automatique par type de tache (heuristique tools + mots-cles FR/EN). Donnees depuis le dernier re-scan.</div>',
    '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">',
    '      <div class="chart-card"><h3>Categories de taches</h3><div class="chart-wrap" style="height:240px"><canvas id="cCatDonut"></canvas></div></div>',
    '      <div class="table-section" style="margin-bottom:0"><h3>Repartition par categorie</h3><div id="tCategories"><div class="loading">Chargement...</div></div></div>',
    '    </div>',
    '    <div class="chart-card" style="margin-bottom:16px">',
    '      <h3>Serveurs MCP (appels)</h3>',
    '      <p id="mcp-empty" class="empty-state" style="display:none">Aucun appel MCP detecte. Les outils MCP ont un prefixe mcp__.</p>',
    '      <div class="chart-wrap" style="height:220px"><canvas id="cMcpBar"></canvas></div>',
    '    </div>',
    '    <div class="table-section"><h3>Outils Claude Code (top 15)</h3><div id="tCoreTools"><div class="loading">Chargement...</div></div></div>',
    '  </div>',
    '  <footer>Nova Stellaris MCP - Donnees locales - ~/.claude/usage.db - Prix API Anthropic (estimatifs)<span id="ref"></span></footer>',
    '</div>',
    `<script>${script}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
