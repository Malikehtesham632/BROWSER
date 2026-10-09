/* Nova Browser UI — vanilla JS, no build step. */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const ic=(n,c='')=>`<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const LOGO='<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="url(#novaGrad)"/><path d="M12 4.2l1.7 6.1 6.1 1.7-6.1 1.7L12 19.8l-1.7-6.1L4.2 12l6.1-1.7z" fill="#fff"/></svg>';

/* ---------- storage (every access guarded) ---------- */
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
};
function loadHistory(){
  const h=store.get('nova-history',null);
  if(Array.isArray(h))return h.filter(x=>x&&typeof x.q==='string');
  const old=store.get('omni-history',[]);               // migrate v10 list of strings
  return (Array.isArray(old)?old:[]).filter(x=>typeof x==='string').map((q,i)=>({q,t:Date.now()-i*60000}));
}
function loadBookmarks(){
  const b=store.get('nova-bookmarks',null);
  if(Array.isArray(b))return b.filter(x=>x&&x.url);
  const old=store.get('omni-bookmarks',[]);             // migrate v10 bookmarks (they were searches)
  return (Array.isArray(old)?old:[]).filter(x=>x&&x.url).map(x=>({kind:'search',title:x.title||x.url,url:x.url,t:Date.now()}));
}
const settings={theme:'auto',num:20,sidebar:false,sbView:'bookmarks',...store.get('nova-settings',{})};
const saveSettings=()=>store.set('nova-settings',settings);

/* ---------- state ---------- */
let tabSeq=1;
const mkTab=()=>({id:tabSeq++,title:'New Tab',stack:[{type:'home'}],idx:0,loading:false,ctrl:null,live:null,filter:null});
const state={tabs:[mkTab()],active:1,history:loadHistory(),bookmarks:loadBookmarks(),health:null};
const activeTab=()=>state.tabs.find(t=>t.id===state.active);
const cur=t=>t.stack[t.idx];
const saveHistory=()=>store.set('nova-history',state.history.slice(0,500));
const saveBookmarks=()=>store.set('nova-bookmarks',state.bookmarks);

/* ---------- helpers ---------- */
const hostOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const siteName=h=>{const p=String(h).split('.').filter(Boolean);return p.length>1?p[p.length-2]:p[0]||''};
const hue=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return h};
const safeHttp=u=>/^https?:\/\//i.test(String(u))?String(u):'#';
const TLD=/^[^\s/]+\.(com|org|net|io|dev|app|ai|co|edu|gov|uk|de|fr|pk|in|info|me|tv|xyz|us|ca|au|jp|ru|cn|br)(:\d+)?(\/\S*)?$/i;
const looksLikeUrl=t=>/^https?:\/\/\S+$/i.test(t)||TLD.test(t);
const normUrl=t=>/^https?:\/\//i.test(t)?t:'https://'+t;
const rx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function highlight(text,terms){
  let out=esc(text);
  const ts=[...new Set((terms||[]).filter(t=>t&&t.length>1))].sort((a,b)=>b.length-a.length).slice(0,8);
  if(!ts.length)return out;
  return out.replace(new RegExp('\\b('+ts.map(t=>rx(esc(t))).join('|')+')',"gi"),'<b>$1</b>');
}
function crumbOf(u){
  try{const x=new URL(u);const parts=x.pathname.split('/').filter(Boolean).slice(0,3).map(p=>decodeURIComponent(p).replace(/[-_]/g,' '));
    return parts.length?'› '+parts.join(' › '):''}catch{return ''}
}
let toastTimer;
function toast(msg,action){
  const e=$('#toast');e.innerHTML=`<span>${esc(msg)}</span>${action?`<button type="button">${esc(action.label)}</button>`:''}`;
  if(action)e.querySelector('button').onclick=()=>{action.run();e.classList.remove('show')};
  e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),action?5000:2200);
}
const dayLabel=t=>{const d=new Date(t),n=new Date(),s=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const diff=Math.round((s(n)-s(d))/86400000);return diff<=0?'Today':diff===1?'Yesterday':diff<7?d.toLocaleDateString([], {weekday:'long'}):d.toLocaleDateString([], {month:'long',day:'numeric',year:'numeric'})};
const timeLabel=t=>new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

/* ---------- theme ---------- */
const mq=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):null;
function applyTheme(){
  const r=document.documentElement;
  if(settings.theme==='auto')r.removeAttribute('data-theme');else r.dataset.theme=settings.theme;
  const dark=settings.theme==='dark'||(settings.theme==='auto'&&mq&&mq.matches);
  window.nova?.setTheme?.(dark?'dark':'light');
  $$('#themeSeg button').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.theme===settings.theme)));
}
mq?.addEventListener?.('change',()=>{if(settings.theme==='auto')applyTheme()});

/* ---------- tabs ---------- */
function tabTitle(t){
  const e=cur(t);
  if(e.type==='home')return 'New Tab';
  if(e.type==='search')return e.q;
  return {history:'History',bookmarks:'Bookmarks',downloads:'Downloads',settings:'Settings'}[e.name]||'Nova';
}
function renderTabs(){
  $('#tabs').innerHTML=state.tabs.map(t=>{
    const sel=t.id===state.active,title=tabTitle(t);
    return `<div class="tab" role="tab" tabindex="0" aria-selected="${sel}" data-id="${t.id}" title="${esc(title)}">
      <span class="tab-fav">${t.loading?'<i class="spinner"></i>':LOGO}</span>
      <span class="tab-title">${esc(title)}</span>
      <button class="tab-close" data-close="${t.id}" title="Close tab (Ctrl+W)" aria-label="Close tab ${esc(title)}" tabindex="-1">${ic('close')}</button></div>`}).join('');
  requestAnimationFrame(()=>$$('.tab').forEach(el=>el.classList.toggle('compact',el.offsetWidth<104)));
}
$('#tabs').addEventListener('click',e=>{
  const c=e.target.closest('[data-close]');if(c){closeTab(+c.dataset.close);return}
  const t=e.target.closest('.tab');if(t)selectTab(+t.dataset.id);
});
$('#tabs').addEventListener('auxclick',e=>{if(e.button!==1)return;const t=e.target.closest('.tab');if(t){e.preventDefault();closeTab(+t.dataset.id)}});
$('#tabs').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('tab')){e.preventDefault();selectTab(+e.target.dataset.id)}});
window.addEventListener('resize',()=>requestAnimationFrame(()=>$$('.tab').forEach(el=>el.classList.toggle('compact',el.offsetWidth<104))));

function newTab(entry){
  const t=mkTab();if(entry){t.stack=[entry]}
  state.tabs.push(t);state.active=t.id;show(t);
  if(!entry||entry.type==='home')$('#searchInput').focus();
}
function selectTab(id){if(id===state.active)return;state.active=id;show(activeTab())}
function closeTab(id){
  const t=state.tabs.find(x=>x.id===id);if(!t)return;stopTab(t);
  if(state.tabs.length===1){state.tabs=[mkTab()];state.active=state.tabs[0].id;show(state.tabs[0]);return}
  const i=state.tabs.indexOf(t);state.tabs.splice(i,1);
  if(state.active===id)state.active=state.tabs[Math.min(i,state.tabs.length-1)].id;
  show(activeTab());
}

/* ---------- navigation ---------- */
function stopTab(t){t.ctrl?.abort();t.ctrl=null;t.loading=false}
function navigate(entry,{replace=false}={}){
  const t=activeTab();stopTab(t);
  if(replace)t.stack[t.idx]=entry;else{t.stack=t.stack.slice(0,t.idx+1);t.stack.push(entry);t.idx++}
  t.filter=null;show(t);
}
function go(delta){const t=activeTab(),i=t.idx+delta;if(i<0||i>=t.stack.length)return;stopTab(t);t.idx=i;t.filter=null;show(t)}
function search(q){q=(q||'').trim();if(!q)return;
  if(looksLikeUrl(q)&&!/\s/.test(q)&&/^https?:\/\//i.test(q)){openUrl(q);return}
  addHistory(q);navigate({type:'search',q})}
function openPage(name){const t=activeTab(),e=cur(t);if(e.type==='page'&&e.name===name)return;navigate({type:'page',name})}
function openUrl(u){const url=normUrl(u);if(!/^https?:\/\//i.test(url))return;window.open(url,'_blank','noopener,noreferrer')}
function addHistory(q){
  state.history=state.history.filter(x=>x.q.toLowerCase()!==q.toLowerCase());
  state.history.unshift({q,t:Date.now()});state.history=state.history.slice(0,500);saveHistory();
}

const VIEWS={home:'#newtabView',search:'#searchView',library:'#libraryView',settings:'#settingsView'};
function showView(k){Object.entries(VIEWS).forEach(([n,sel])=>$(sel).classList.toggle('hidden',n!==k))}
function show(tab){
  const e=cur(tab);
  renderTabs();renderSidebar();closeSuggest();if(e.type!=='home')input.blur();
  $('#loadbar').classList.toggle('on',Boolean(tab.loading&&e.type==='search'));$('#loadbarFill').style.width=(tab.live?.progress||0)+'%';
  if(e.type==='home'){showView('home');setAddress('');renderShortcuts();refreshHealth()}
  else if(e.type==='search'){showView('search');setAddress(e.q);paintSearch(tab,e);if(!e.data&&!e.error&&!tab.loading)startSearch(tab,e)}
  else if(e.name==='settings'){showView('settings');setAddress('nova://settings');syncSettings()}
  else{showView('library');setAddress('nova://'+e.name);renderLibrary(e.name)}
  updateNav();$('#page').scrollTop=0;
}
function setAddress(v){$('#searchInput').value=v;$('#heroInput').value=e2h(v);toggleClear();updateStar();
  const cur_=cur(activeTab());$('#urlIcon').innerHTML=ic(cur_.type==='search'?'search':cur_.type==='page'?'settings':'search')}
const e2h=v=>/^nova:\/\//.test(v)?'':v;
function updateNav(){const t=activeTab();$('#backBtn').disabled=t.idx<=0;$('#forwardBtn').disabled=t.idx>=t.stack.length-1;
  $('#reloadBtn').innerHTML=ic(t.loading?'stop':'reload');$('#reloadBtn').title=t.loading?'Stop (Esc)':'Reload (Ctrl+R)'}
function toggleClear(){$('#clearBtn').classList.toggle('hidden',!$('#searchInput').value)}

/* ---------- search ---------- */
function logEvent(tab,text,done=false){
  if(!tab.live)return;tab.live.events.push({text,done,t:performance.now()-tab.live.started});
  if(tab.live.events.length>6)tab.live.events.shift();
}
function setProgress(tab,n){if(tab.live)tab.live.progress=Math.min(100,Math.max(0,n))}
const updateProgress=(done,total)=>total?Math.round(18+(Math.min(done,total)/total)*72):18;

async function startSearch(tab,entry){
  tab.ctrl?.abort();const ctrl=tab.ctrl=new AbortController();
  tab.live=entry.live={events:[],order:[],providers:{},progress:6,started:performance.now(),state:'running'};
  tab.loading=true;entry.error=null;renderTabs();updateNav();
  logEvent(tab,'Preparing Omni search pipeline');paintLive(tab);
  let providersDone=0,providersTotal=0;
  try{
    const r=await fetch(`/search/stream?q=${encodeURIComponent(entry.q)}&num=${settings.num}`,{signal:ctrl.signal});
    if(!r.ok)throw new Error(`Search failed (${r.status})`);
    if(!r.body)throw new Error('Streaming is unavailable');
    const reader=r.body.getReader(),decoder=new TextDecoder();let buf='';
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buf+=decoder.decode(value,{stream:true});
      const chunks=buf.split('\n\n');buf=chunks.pop();
      for(const chunk of chunks){
        const lines=chunk.split('\n');
        const type=lines.find(x=>x.startsWith('event:'))?.slice(6).trim();
        const dataLine=lines.find(x=>x.startsWith('data:'));if(!dataLine)continue;
        let data;try{data=JSON.parse(dataLine.slice(5))}catch{continue}
        if(type==='start'){
          providersDone=0;providersTotal=(data.providers||[]).length;
          tab.live.order=[...(data.providers||[])];
          logEvent(tab,`Connected to ${providersTotal} search source${providersTotal===1?'':'s'}${data.indexDocuments?` · ${data.indexDocuments} indexed pages`:''}`);
          setProgress(tab,12);
        }else if(type==='provider'){
          const p=data.provider;providersDone++;providersTotal=Math.max(providersTotal,providersDone);
          if(!tab.live.order.includes(p.name))tab.live.order.push(p.name);
          tab.live.providers[p.name]=p;
          setProgress(tab,Math.min(90,updateProgress(providersDone,providersTotal)));
          logEvent(tab,`${p.ok?'Received':'Skipped'} ${p.name}${p.ok?` — ${p.count} results in ${p.ms}ms`:''}`,p.ok);
        }else if(type==='done'){
          entry.data=data;setProgress(tab,100);tab.live.state='done';
          Object.values(data.providers||{}).forEach(p=>{tab.live.providers[p.name]=p});
          logEvent(tab,`Merged ${(data.results||[]).length} ranked results`,true);
        }else if(type==='error'){throw new Error(data.error)}
      }
      paintLive(tab);
    }
    if(!entry.data&&!ctrl.signal.aborted)throw new Error('The search ended without results');
  }catch(e){
    if(e.name!=='AbortError'&&!ctrl.signal.aborted){entry.error=e.message||'Search failed';tab.live.state='error';logEvent(tab,'Search request failed')}
  }finally{
    if(tab.ctrl===ctrl){tab.loading=false;tab.ctrl=null}
    renderTabs();
    if(state.active===tab.id&&cur(tab)===entry){paintSearch(tab,entry);updateNav();
      setTimeout(()=>$('#loadbar').classList.remove('on'),350)}
  }
}

function paintLive(tab){
  if(state.active!==tab.id||cur(tab).type!=='search')return;
  const lb=$('#loadbar');lb.classList.toggle('on',tab.loading);$('#loadbarFill').style.width=(tab.live?.progress||0)+'%';
  paintSearch(tab,cur(tab));
}

function sourceCounts(entry){
  const m={};for(const r of entry.data?.results||[])for(const s of (r.sources&&r.sources.length?r.sources:[r.source]))if(s)m[s]=(m[s]||0)+1;return m;
}

function paintSearch(tab,entry){
  const live=entry.live||{events:[],order:[],providers:{},progress:0,started:performance.now()},data=entry.data;
  // chips
  const counts=data?sourceCounts(entry):{};
  const names=live?.order?.length?live.order:Object.keys(live?.providers||{});
  const chips=names.map(n=>{
    const p=live.providers[n];const sel=tab.filter===n;
    const cls=!p?'wait':p.ok?'ok':'skip';
    const lead=!p?'<i class="spinner"></i>':p.ok?ic('check'):ic('alert');
    const num=data?(counts[n]||0):(p?.ok?p.count:'');
    const tip=p?(p.ok?`${p.count} results in ${p.ms}ms`:'Skipped (not configured or unavailable)'):'Waiting for response';
    return `<button class="chip ${cls} ${sel?'on':''}" data-source="${esc(n)}" ${data&&counts[n]?'':'disabled'} title="${esc(tip)}" aria-pressed="${sel}">${lead}<span>${esc(n)}</span>${num!==''?`<span class="n">${esc(num)}</span>`:''}</button>`}).join('');
  $('#sourceChips').innerHTML=chips;
  // summary
  const sm=$('#summaryLine');
  if(entry.error)sm.textContent='';
  else if(data)sm.textContent=`About ${(data.results||[]).length} results (${((data.tookMs??0)/1000).toFixed(2)} seconds)${data.cached?' · cached':''}`;
  else sm.textContent=tab.loading&&entry.live?`Searching… ${((performance.now()-live.started)/1000).toFixed(1)}s`:'';
  // results
  const box=$('#results');
  if(entry.error){
    box.innerHTML=`<div class="state"><h3>Search unavailable</h3><p>${esc(entry.error)}. Check that the Omni Engine is running and that at least one provider or the local index is configured.</p><button class="btn primary" id="retryBtn">Try again</button></div>`;
  }else if(data){
    const rs=(data.results||[]).filter(r=>!tab.filter||(r.sources||[r.source]).includes(tab.filter));
    const terms=[...(data.analysis?.terms||[]),...(data.analysis?.phrases||[])];
    box.innerHTML=rs.length?rs.map(r=>resultHtml(r,terms)).join(''):`<div class="state"><h3>No results found</h3><p>Try a broader query, remove filters, or check the configured providers.</p></div>`;
  }else{
    box.innerHTML=[0,1,2,3].map(()=>'<div class="skeleton"><div class="sk" style="width:38%"></div><div class="sk" style="width:82%;height:18px"></div><div class="sk" style="width:96%"></div><div class="sk" style="width:70%"></div></div>').join('');
  }
  // side cards
  const a=data?.analysis;
  $('#queryIntel').innerHTML=a?`<span class="lbl">Intent</span><span class="tag">${esc(a.intent||'general')}</span>
    <span class="lbl">Key terms</span>${(a.terms||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')||'—'}
    ${a.phrases?.length?`<span class="lbl">Exact phrases</span>${a.phrases.map(x=>`<span class="tag">“${esc(x)}”</span>`).join('')}`:''}
    ${a.site?`<span class="lbl">Site</span><span class="tag">${esc(a.site)}</span>`:''}`:'<span class="lbl">Analyzing query…</span>';
  $('#activityLog').innerHTML=(live?.events||[]).map(ev=>`<li class="${ev.done?'done':''}"><time>${(ev.t/1000).toFixed(1)}s</time><span>${esc(ev.text)}</span></li>`).join('');
}

function resultHtml(r,terms){
  const host=hostOf(r.url),saved=state.bookmarks.some(b=>b.url===r.url);
  const srcs=r.sources&&r.sources.length?r.sources:[r.source].filter(Boolean);
  const date=r.publishedAt&&!isNaN(Date.parse(r.publishedAt))?new Date(r.publishedAt).toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'}):'';
  return `<article class="result" data-url="${esc(r.url)}">
    <div class="r-head"><span class="fav" style="--h:${hue(siteName(host))}">${esc((siteName(host)[0]||'•').toUpperCase())}</span>
      <div class="r-site"><span class="r-name">${esc(host)}</span><span class="r-crumb">${esc(crumbOf(r.url))}</span></div>
      <button class="icon-btn sm r-save ${saved?'starred':''}" data-save title="${saved?'Remove bookmark':'Bookmark this page'}" aria-label="${saved?'Remove bookmark':'Bookmark this page'}" data-title="${esc(r.title||host)}">${ic('star')}</button></div>
    <h3><a href="${esc(safeHttp(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.title||r.url||'Untitled result')}</a></h3>
    <p class="r-snippet">${highlight(r.snippet||r.description||'No description available.',terms)}</p>
    <div class="r-foot">${date?`<span>${esc(date)}</span>`:''}${srcs.map(s=>`<span class="src ${srcs.length>1?'multi':''}">${esc(s)}</span>`).join('')}${srcs.length>1?`<span>Found by ${srcs.length} sources</span>`:''}</div>
  </article>`;
}
$('#results').addEventListener('click',e=>{
  if(e.target.closest('#retryBtn')){const t=activeTab();stopTab(t);startSearch(t,cur(t));return}
  const sv=e.target.closest('[data-save]');if(!sv)return;
  const card=sv.closest('.result'),url=card.dataset.url;
  toggleBookmark({kind:'page',url,title:sv.dataset.title});
  const on=state.bookmarks.some(b=>b.url===url);sv.classList.toggle('starred',on);
  sv.title=on?'Remove bookmark':'Bookmark this page';
});
$('#sourceChips').addEventListener('click',e=>{
  const c=e.target.closest('[data-source]');if(!c||c.disabled)return;
  const t=activeTab();t.filter=t.filter===c.dataset.source?null:c.dataset.source;paintSearch(t,cur(t));
});
setInterval(()=>{const t=activeTab();if(t.loading&&t.live&&cur(t).type==='search')$('#summaryLine').textContent=`Searching… ${((performance.now()-t.live.started)/1000).toFixed(1)}s`},200);

/* ---------- bookmarks ---------- */
function toggleBookmark(b){
  const i=state.bookmarks.findIndex(x=>x.url===b.url);
  if(i>=0){const [rm]=state.bookmarks.splice(i,1);saveBookmarks();toast('Bookmark removed',{label:'Undo',run:()=>{state.bookmarks.splice(i,0,rm);saveBookmarks();renderSidebar();updateStar();if(cur(activeTab()).type==='page')show(activeTab())}})}
  else{state.bookmarks.unshift({...b,t:Date.now()});saveBookmarks();toast('Bookmark saved')}
  renderSidebar();updateStar();
}
function updateStar(){
  const e=cur(activeTab()),btn=$('#starBtn');if(!btn)return;
  const can=e.type==='search',on=can&&state.bookmarks.some(b=>b.url===e.q);
  btn.disabled=!can;btn.classList.toggle('starred',on);btn.setAttribute('aria-pressed',String(on));
  btn.title=on?'Remove bookmark (Ctrl+D)':'Bookmark this search (Ctrl+D)';
}
$('#starBtn').onclick=()=>{const e=cur(activeTab());if(e.type==='search')toggleBookmark({kind:'search',url:e.q,title:e.q})};
function openBookmark(b){b.kind==='page'?openUrl(b.url):search(b.url)}

/* ---------- address bar + suggestions ---------- */
const input=$('#searchInput');let sg={items:[],sel:-1,open:false};
function suggestions(text){
  const t=text.trim(),tl=t.toLowerCase(),out=[],seen=new Set();
  const add=i=>{const k=i.k+':'+(i.q||i.url);if(!seen.has(k)){seen.add(k);out.push(i)}};
  if(t){
    if(looksLikeUrl(t)&&!/\s/.test(t))add({k:'url',url:normUrl(t),label:t,tag:'Open site'});
    add({k:'search',q:t,label:t,tag:'Search with Omni'});
  }
  state.bookmarks.filter(b=>!tl||(b.title+' '+b.url).toLowerCase().includes(tl)).slice(0,3)
    .forEach(b=>add({k:'bookmark',b,label:b.kind==='page'?b.title:b.url,tag:'Bookmark'}));
  state.history.filter(h=>!tl||h.q.toLowerCase().includes(tl)).filter(h=>h.q.toLowerCase()!==tl).slice(0,6)
    .forEach(h=>add({k:'history',q:h.q,label:h.q,tag:'History'}));
  return out.slice(0,9);
}
const sgIcon={url:'globe',search:'search',bookmark:'star',history:'history'};
function renderSuggest(){
  const box=$('#suggest');
  if(!sg.open||!sg.items.length){box.classList.add('hidden');input.setAttribute('aria-expanded','false');return}
  const tl=input.value.trim();
  let head='';
  if(!tl)head='<div class="sg-head">Recent</div>';
  box.innerHTML=head+sg.items.map((it,i)=>{
    let label=esc(it.label);
    if(tl&&it.k!=='search'&&it.k!=='url'){const m=it.label.toLowerCase().indexOf(tl.toLowerCase());if(m>=0)label=esc(it.label.slice(0,m))+'<b>'+esc(it.label.slice(m,m+tl.length))+'</b>'+esc(it.label.slice(m+tl.length))}
    return `<div class="sg" role="option" id="sg${i}" data-i="${i}" aria-selected="${i===sg.sel}">${ic(sgIcon[it.k])}<span class="sg-text">${label}</span><span class="sg-tag">${esc(it.tag)}</span></div>`}).join('');
  box.classList.remove('hidden');input.setAttribute('aria-expanded','true');
  if(sg.sel>=0)input.setAttribute('aria-activedescendant','sg'+sg.sel);else input.removeAttribute('aria-activedescendant');
}
function openSuggest(){sg.items=suggestions(input.value);sg.sel=-1;sg.open=true;renderSuggest()}
function closeSuggest(){sg.open=false;renderSuggest()}
function activate(it){
  closeSuggest();input.blur();
  if(it.k==='url')openUrl(it.url);else if(it.k==='bookmark')openBookmark(it.b);else search(it.q);
}
input.addEventListener('focus',()=>{input.select();openSuggest()});
input.addEventListener('input',()=>{toggleClear();openSuggest()});
input.addEventListener('blur',()=>setTimeout(closeSuggest,120));
input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!sg.open)openSuggest();e.preventDefault();
    const n=sg.items.length;if(!n)return;
    sg.sel=e.key==='ArrowDown'?(sg.sel+1)%n:(sg.sel-1+n)%n;renderSuggest();
    $('#sg'+sg.sel)?.scrollIntoView({block:'nearest'});
  }else if(e.key==='Escape'){
    if(sg.open){closeSuggest()}else{const t=activeTab(),e2=cur(t);setAddress(e2.type==='search'?e2.q:e2.type==='page'?'nova://'+e2.name:'');input.blur()}
    e.stopPropagation();
  }
});
$('#suggest').addEventListener('mousedown',e=>{const r=e.target.closest('.sg');if(r){e.preventDefault();activate(sg.items[+r.dataset.i])}});
$('#searchForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(sg.open&&sg.sel>=0&&sg.items[sg.sel])return activate(sg.items[sg.sel]);
  const t=input.value.trim();if(!t)return;
  closeSuggest();input.blur();
  if(looksLikeUrl(t)&&!/\s/.test(t))openUrl(t);else search(t);
});
$('#clearBtn').onclick=()=>{input.value='';toggleClear();input.focus()};
$('#heroForm').addEventListener('submit',e=>{e.preventDefault();const t=$('#heroInput').value.trim();if(!t)return;
  if(looksLikeUrl(t)&&!/\s/.test(t))openUrl(t);else search(t)});

/* ---------- new tab shortcuts ---------- */
const DEFAULT_TILES=['latest technology news','learn Python programming','developer tools','science discoveries'];
function renderShortcuts(){
  const tiles=[],seen=new Set();
  const push=t=>{const k=t.url||t.q;if(!seen.has(k)&&tiles.length<8){seen.add(k);tiles.push(t)}};
  state.bookmarks.slice(0,4).forEach(b=>push(b.kind==='page'?{url:b.url,label:b.title,host:hostOf(b.url)}:{q:b.url,label:b.url}));
  const freq={};state.history.forEach(h=>freq[h.q]=(freq[h.q]||0)+1);
  Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,4).forEach(([q])=>push({q,label:q}));
  DEFAULT_TILES.forEach(q=>push({q,label:q}));
  $('#shortcuts').innerHTML=tiles.slice(0,8).map((t,i)=>{
    const seed=t.host?siteName(t.host):t.q,letter=(seed[0]||'•').toUpperCase();
    const icon=t.host?`<span class="tile-icon" style="background:hsl(${hue(siteName(t.host))} 45% 42%)">${esc(letter)}</span>`:`<span class="tile-icon plain">${ic('search')}</span>`;
    return `<button class="tile" data-i="${i}" title="${esc(t.label)}">${icon}<span class="tile-label">${esc(t.label)}</span></button>`}).join('');
  $('#shortcuts').onclick=e=>{const b=e.target.closest('.tile');if(!b)return;const t=tiles[+b.dataset.i];t.url?openUrl(t.url):search(t.q)};
}

/* ---------- engine health ---------- */
async function refreshHealth(){
  const el=$('#engineStatus');
  try{
    const r=await fetch('/health',{cache:'no-store'});if(!r.ok)throw 0;const h=await r.json();state.health=h;
    const n=(h.providers||[]).length,docs=h.index?.documents??h.index?.count??0;
    el.innerHTML=`<i class="dot ok"></i><span>Omni Engine online · ${n} source${n===1?'':'s'}${docs?` · ${Number(docs).toLocaleString()} pages indexed`:''}</span>`;
  }catch{
    state.health=null;el.innerHTML=`<i class="dot bad"></i><span>Omni Engine is not responding</span><button type="button" id="healthRetry">Retry</button>`;
    $('#healthRetry').onclick=refreshHealth;
  }
  const d=$('#engineDetail');if(d)d.textContent=state.health?`Online · sources: ${(state.health.providers||[]).join(', ')||'none'}`:'Not responding on this device.';
}

/* ---------- sidebar ---------- */
function setSidebar(open,view){
  settings.sidebar=open;if(view)settings.sbView=view;saveSettings();
  $('#sidebar').classList.toggle('collapsed',!open);$('#sidebarBtn').setAttribute('aria-pressed',String(open));
  $$('#sbSeg button').forEach(b=>{const on=b.dataset.sb===settings.sbView;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))});
  $('#sbFilter').placeholder=settings.sbView==='bookmarks'?'Search bookmarks':'Search history';
  if(open)renderSidebar();
}
function renderSidebar(){
  if($('#sidebar').classList.contains('collapsed'))return;
  const f=$('#sbFilter').value.trim().toLowerCase(),box=$('#sbList');
  if(settings.sbView==='bookmarks'){
    const items=state.bookmarks.filter(b=>!f||(b.title+b.url).toLowerCase().includes(f));
    box.innerHTML=items.length?items.map((b,i)=>`<button class="sb-item" data-b="${state.bookmarks.indexOf(b)}">${ic(b.kind==='page'?'globe':'search')}<span class="t">${esc(b.title||b.url)}</span></button>`).join(''):`<div class="sb-empty">${f?'No matches.':'No bookmarks yet. Press Ctrl+D on a search to save it.'}</div>`;
  }else{
    const items=state.history.filter(h=>!f||h.q.toLowerCase().includes(f)).slice(0,100);
    box.innerHTML=items.length?items.map(h=>`<button class="sb-item" data-q="${esc(h.q)}">${ic('history')}<span class="t">${esc(h.q)}</span></button>`).join(''):`<div class="sb-empty">${f?'No matches.':'Your searches will show up here.'}</div>`;
  }
}
$('#sbList').addEventListener('click',e=>{const b=e.target.closest('.sb-item');if(!b)return;
  if(b.dataset.b!=null)openBookmark(state.bookmarks[+b.dataset.b]);else search(b.dataset.q)});
$('#sbSeg').addEventListener('click',e=>{const b=e.target.closest('[data-sb]');if(b){$('#sbFilter').value='';setSidebar(true,b.dataset.sb)}});
$('#sbFilter').addEventListener('input',renderSidebar);
$('#sbClose').onclick=()=>setSidebar(false);
$('#sidebarBtn').onclick=()=>setSidebar(!settings.sidebar);

/* ---------- library pages ---------- */
function renderLibrary(name){
  const v=$('#libraryView');
  const head=(title,extra='')=>`<div class="lib-head"><h1>${title}</h1><div class="lib-tools">${extra}</div></div>`;
  const filterBox=ph=>`<label class="field">${ic('search')}<input id="libFilter" placeholder="${ph}" aria-label="${ph}"></label>`;
  if(name==='downloads'){
    v.innerHTML=`<div class="lib-inner">${head('Downloads')}<div class="lib-list"><div class="empty">${ic('download')}<b>No downloads yet</b><span>Files you download will appear here.</span></div></div></div>`;return;
  }
  if(name==='history'){
    v.innerHTML=`<div class="lib-inner">${head('History',filterBox('Search history')+`<button class="btn" id="libClear">Clear history…</button>`)}<div id="libBody"></div></div>`;
    const draw=()=>{
      const f=($('#libFilter').value||'').trim().toLowerCase(),items=state.history.filter(h=>!f||h.q.toLowerCase().includes(f));
      if(!items.length){$('#libBody').innerHTML=`<div class="lib-list"><div class="empty">${ic('history')}<b>${f?'No matches':'No history yet'}</b><span>${f?'Try another search.':'Searches you make will be listed here.'}</span></div></div>`;return}
      let out='',last='';
      for(const h of items){const d=dayLabel(h.t);if(d!==last){if(last)out+='</div>';out+=`<div class="lib-group">${esc(d)}</div><div class="lib-list">`;last=d}
        out+=`<div class="lib-row"><button class="main" data-q="${esc(h.q)}">${ic('history')}<span style="min-width:0"><span class="t">${esc(h.q)}</span></span></button><time>${timeLabel(h.t)}</time><button class="icon-btn sm rm" data-rm="${esc(h.q)}" title="Remove from history" aria-label="Remove ${esc(h.q)} from history">${ic('trash')}</button></div>`}
      $('#libBody').innerHTML=out+'</div>';
    };
    draw();$('#libFilter').oninput=draw;
    $('#libBody').onclick=e=>{const rm=e.target.closest('[data-rm]');if(rm){state.history=state.history.filter(h=>h.q!==rm.dataset.rm);saveHistory();draw();return}
      const m=e.target.closest('[data-q]');if(m)search(m.dataset.q)};
    $('#libClear').onclick=()=>{if(!state.history.length)return;const old=state.history;state.history=[];saveHistory();draw();
      toast('History cleared',{label:'Undo',run:()=>{state.history=old;saveHistory();if(cur(activeTab()).name==='history')draw()}})};
    return;
  }
  v.innerHTML=`<div class="lib-inner">${head('Bookmarks',filterBox('Search bookmarks'))}<div id="libBody"></div></div>`;
  const draw=()=>{
    const f=($('#libFilter').value||'').trim().toLowerCase(),items=state.bookmarks.filter(b=>!f||(b.title+b.url).toLowerCase().includes(f));
    if(!items.length){$('#libBody').innerHTML=`<div class="lib-list"><div class="empty">${ic('star')}<b>${f?'No matches':'No bookmarks yet'}</b><span>${f?'Try another search.':'Press Ctrl+D on a search, or use the star on a result.'}</span></div></div>`;return}
    $('#libBody').innerHTML=`<div class="lib-list">`+items.map(b=>{const i=state.bookmarks.indexOf(b);
      return `<div class="lib-row"><button class="main" data-b="${i}">${ic(b.kind==='page'?'globe':'search')}<span style="min-width:0"><span class="t">${esc(b.title||b.url)}</span><span class="u">${b.kind==='page'?esc(b.url):'Saved search'}</span></span></button><button class="icon-btn sm rm" data-rm="${i}" title="Remove bookmark" aria-label="Remove bookmark">${ic('trash')}</button></div>`}).join('')+`</div>`;
  };
  draw();$('#libFilter').oninput=draw;
  $('#libBody').onclick=e=>{const rm=e.target.closest('[data-rm]');if(rm){toggleBookmark(state.bookmarks[+rm.dataset.rm]);draw();return}
    const m=e.target.closest('[data-b]');if(m)openBookmark(state.bookmarks[+m.dataset.b])};
}

/* ---------- settings ---------- */
function syncSettings(){
  $$('#themeSeg button').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.theme===settings.theme)));
  $('#numSelect').value=String(settings.num);refreshHealth();
}
$('#themeSeg').addEventListener('click',e=>{const b=e.target.closest('[data-theme]');if(!b)return;settings.theme=b.dataset.theme;saveSettings();applyTheme()});
$('#numSelect').onchange=e=>{settings.num=Number(e.target.value)||20;saveSettings();toast(`Showing up to ${settings.num} results`)};
$('#engineRecheck').onclick=refreshHealth;
$('#clearHistoryBtn').onclick=()=>{const old=state.history;state.history=[];saveHistory();toast('History cleared',{label:'Undo',run:()=>{state.history=old;saveHistory()}})};
$('#clearBookmarksBtn').onclick=()=>{const old=state.bookmarks;state.bookmarks=[];saveBookmarks();renderSidebar();toast('Bookmarks removed',{label:'Undo',run:()=>{state.bookmarks=old;saveBookmarks();renderSidebar()}})};

/* ---------- toolbar + menu ---------- */
$('#newTabBtn').onclick=()=>newTab();
$('#backBtn').onclick=()=>go(-1);
$('#forwardBtn').onclick=()=>go(1);
$('#homeBtn').onclick=()=>navigate({type:'home'});
$('#downloadsBtn').onclick=()=>openPage('downloads');
function reloadOrStop(){const t=activeTab(),e=cur(t);
  if(t.loading){t.ctrl?.abort();t.loading=false;if(t.live)t.live.state='stopped';renderTabs();updateNav();$('#loadbar').classList.remove('on');if(e.type==='search'&&!e.data){e.error='Search stopped.';paintSearch(t,e)}return}
  if(e.type==='search'){e.data=null;e.error=null;t.filter=null;show(t)}else show(t)}
$('#reloadBtn').onclick=reloadOrStop;

const menu=$('#appMenu');
function toggleMenu(force){const open=force??menu.classList.contains('hidden');menu.classList.toggle('hidden',!open);$('#menuBtn').setAttribute('aria-expanded',String(open));if(open)menu.querySelector('button').focus()}
$('#menuBtn').onclick=e=>{e.stopPropagation();toggleMenu()};
document.addEventListener('click',e=>{if(!menu.classList.contains('hidden')&&!menu.contains(e.target))toggleMenu(false)});
menu.addEventListener('click',e=>{
  const b=e.target.closest('[data-go]');if(!b)return;toggleMenu(false);
  const k=b.dataset.go;
  if(k==='newtab')newTab();else if(k==='sidebar')setSidebar(!settings.sidebar);
  else if(k==='updates'){openPage('settings');setTimeout(()=>$('#updateBtn').click(),50)}
  else openPage(k);
});

/* ---------- keyboard ---------- */
document.addEventListener('keydown',e=>{
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
  if(mod&&k==='l'||e.key==='F6'){e.preventDefault();input.focus();input.select();return}
  if(mod&&k==='t'){e.preventDefault();newTab();return}
  if(mod&&k==='w'){e.preventDefault();closeTab(state.active);return}
  if(mod&&k==='d'){e.preventDefault();$('#starBtn').click();return}
  if(mod&&k==='b'){e.preventDefault();setSidebar(!settings.sidebar);return}
  if(mod&&k==='h'){e.preventDefault();openPage('history');return}
  if(mod&&k==='j'){e.preventDefault();openPage('downloads');return}
  if(mod&&e.shiftKey&&k==='o'){e.preventDefault();openPage('bookmarks');return}
  if(mod&&e.key===','){e.preventDefault();openPage('settings');return}
  if(mod&&k==='r'||e.key==='F5'){e.preventDefault();reloadOrStop();return}
  if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();go(-1);return}
  if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();go(1);return}
  if(e.ctrlKey&&e.key==='Tab'){e.preventDefault();const i=state.tabs.findIndex(t=>t.id===state.active),n=state.tabs.length;selectTab(state.tabs[(i+(e.shiftKey?-1:1)+n)%n].id);return}
  if(mod&&/^[1-9]$/.test(e.key)){e.preventDefault();const n=+e.key;selectTab((n===9?state.tabs.at(-1):state.tabs[n-1]||state.tabs.at(-1)).id);return}
  if(e.key==='Escape'){
    if(!menu.classList.contains('hidden'))return toggleMenu(false);
    const t=activeTab();if(t.loading)reloadOrStop();
  }
});

/* ---------- desktop updater (Electron) ---------- */
function bindUpdates(){
  const button=$('#updateBtn');if(!button)return;
  const status=$('#updateStatus'),badge=$('#updateBadge');
  const set=(text,kind='')=>{status.textContent=text;status.className='update-status '+kind;};
  if(!window.nova){button.onclick=()=>set('Updates are available in the installed Nova Browser.');return;}
  window.nova.onUpdate('checking',()=>set('Checking for updates…','checking'));
  window.nova.onUpdate('available',info=>{set(`Version ${info.version} is available.`,'available');button.disabled=false;button.textContent='Download update';button.dataset.action='download';badge.classList.remove('hidden');});
  window.nova.onUpdate('not-available',info=>{button.disabled=false;set(`Nova Browser ${info.version||''} is up to date.`,'ok')});
  window.nova.onUpdate('progress',info=>set(`Downloading update… ${Math.round(info.percent||0)}%`,'checking'));
  window.nova.onUpdate('downloaded',info=>{set(`Version ${info.version} is ready to install.`,'available');button.disabled=false;button.textContent='Restart & install';button.dataset.action='install';badge.classList.remove('hidden');});
  window.nova.onUpdate('error',info=>{button.disabled=false;set(info.message||'Could not check for updates.','error')});
  button.onclick=async()=>{
    try{
      const action=button.dataset.action;
      if(action==='download'){button.disabled=true;await window.nova.downloadUpdate();return;}
      if(action==='install'){await window.nova.installUpdate();return;}
      button.disabled=true;set('Checking for updates…','checking');await window.nova.checkForUpdates();button.disabled=false;
    }catch(e){button.disabled=false;set(e.message||'Could not check for updates.','error');}
  };
  window.nova.version().then(v=>{const el=$('#browserVersion');if(el)el.textContent=`Nova Browser ${v}`;}).catch(()=>{});
  if(window.nova.platform==='darwin')document.documentElement.classList.add('platform-darwin');
}

/* ---------- boot ---------- */
applyTheme();setSidebar(settings.sidebar);bindUpdates();show(activeTab());
