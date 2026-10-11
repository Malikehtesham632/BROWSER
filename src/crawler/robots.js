function matchesRule(pathname, rule) {
  if (!rule) return false;
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const escaped = body.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + escaped + (anchored ? '$' : '')).test(pathname);
}

function parseRobots(text, userAgent) {
  const groups=[];let current=null;
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.split('#')[0].trim();if(!line)continue;
    const i=line.indexOf(':');if(i<0)continue;const key=line.slice(0,i).trim().toLowerCase();const value=line.slice(i+1).trim();
    if(key==='user-agent'){current={agents:[],rules:[],delay:null};groups.push(current);current.agents.push(value.toLowerCase());}
    else if(!current)continue;
    else if(key==='user-agent')current.agents.push(value.toLowerCase());
    else if(key==='disallow')current.rules.push({type:'disallow',value});
    else if(key==='allow')current.rules.push({type:'allow',value});
    else if(key==='crawl-delay'){const n=Number(value);if(Number.isFinite(n)&&n>=0)current.delay=n*1000;}
  }
  const ua=String(userAgent||'OmniBot/1.0').toLowerCase();
  const matching=groups.filter(g=>g.agents.includes(ua));
  const selected=matching.length?matching:groups.filter(g=>g.agents.includes('*'));
  return selected.length?selected[0]:{agents:[],rules:[],delay:null};
}

export async function fetchRobots(url,{fetchImpl=fetch,timeoutMs=4000,userAgent='OmniBot/1.0'}={}) {
  const u=new URL(url);const robots=new URL('/robots.txt',u);
  let res;
  try { res=await fetchImpl(robots,{headers:{'user-agent':userAgent},signal:AbortSignal.timeout(timeoutMs)}); }
  catch { return {allowed:false,delayMs:null,failed:true}; }
  if(res.status>=400&&res.status<500) return {allowed:true,delayMs:null,failed:false};
  if(!res.ok) return {allowed:false,delayMs:null,failed:true};
  const policy=parseRobots(await res.text(),userAgent);const pathname=u.pathname;
  let bestAllow=-1,bestDisallow=-1;
  for(const rule of policy.rules){if(!rule.value)continue;if(matchesRule(pathname,rule.value)){const len=rule.value.replace(/\*/g,'').length;if(rule.type==='allow')bestAllow=Math.max(bestAllow,len);else bestDisallow=Math.max(bestDisallow,len);}}
  return {allowed:bestAllow>=bestDisallow,delayMs:policy.delay,failed:false};
}

export async function canCrawl(url,opts={}) { return (await fetchRobots(url,opts)).allowed; }

export class RobotsChecker {
  constructor(opts={}){this.opts=opts;this.cache=new Map();}
  async check(url){const origin=new URL(url).origin;if(!this.cache.has(origin))this.cache.set(origin,await fetchRobots(url,this.opts));return this.cache.get(origin);}
}
