import { canonicalUrlKey } from "./url.js";

export function fuseResults(lists, {k=60, weights={}, limit=20}={}) {
  const merged = new Map();
  for (const {source, results=[]} of lists) {
    const weight = weights[source] ?? 1;
    results.forEach((result,index)=>{
      const key=canonicalUrlKey(result.url); if(!key) return;
      const rank=result.rank ?? index+1;
      let e=merged.get(key);
      if(!e) {
        e={url:result.url,title:result.title||"",snippet:result.snippet||"",
           source,sources:[],publishedAt:result.publishedAt??null,score:0,ranks:{}};
        merged.set(key,e);
      }
      if(e.ranks[source] !== undefined) return;
      e.ranks[source]=rank; e.sources.push(source); e.score += weight/(k+rank);
      if(!e.title && result.title)e.title=result.title;
      if((result.snippet||"").length > e.snippet.length)e.snippet=result.snippet;
      if(!e.publishedAt && result.publishedAt)e.publishedAt=result.publishedAt;
    });
  }
  return [...merged.values()].sort((a,b)=>b.score-a.score || b.sources.length-a.sources.length)
    .slice(0,limit).map(e=>({...e,score:Math.round(e.score*1e5)/1e5}));
}
