function matchesRule(pathname, rule) {
  if (!rule) return false;
  const hasWildcard = rule.includes('*') || rule.endsWith('$');
  if (!hasWildcard) return pathname.startsWith(rule);
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const escaped = body.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const re = new RegExp('^' + escaped + (anchored ? '$' : ''));
  return re.test(pathname);
}

export async function canCrawl(url,{fetchImpl=fetch,timeoutMs=4000,userAgent='OmniBot/1.0'}={}){
  try{const u=new URL(url);const robots=new URL('/robots.txt',u);const res=await fetchImpl(robots,{headers:{'user-agent':userAgent},signal:AbortSignal.timeout(timeoutMs)});if(!res.ok)return true;const text=await res.text();let applies=false;let allowed=true;const pathname=new URL(url).pathname;for(const line of text.split(/\r?\n/)){const s=line.split('#')[0].trim();if(!s)continue;const [k,v]=s.split(':',2).map(x=>x.trim());if(k?.toLowerCase()==='user-agent')applies=v==='*'||v.toLowerCase()===userAgent.toLowerCase();else if(applies&&k?.toLowerCase()==='disallow'&&v){if(matchesRule(pathname,v))allowed=false}else if(applies&&k?.toLowerCase()==='allow'&&v){if(matchesRule(pathname,v))allowed=true}}return allowed;}catch{return true;}
}
