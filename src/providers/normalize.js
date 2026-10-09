const MAX_SNIPPET=500;
function pickSnippet(item){
  if(Array.isArray(item.highlights)&&item.highlights.length)return item.highlights.join(" … ");
  return item.snippet||item.description||item.content||item.text||"";
}
export function normalizeSearchResult(item,source,rank=null,{includeRaw=false}={}){
  if(!item||typeof item!=="object")return null;
  const url=item.url||item.link||item.sourceUrl||null;
  if(typeof url!=="string"||!/^https?:\/\//i.test(url))return null;
  const result={url,title:String(item.title||item.name||"").trim(),
    snippet:String(pickSnippet(item)).replace(/\s+/g," ").trim().slice(0,MAX_SNIPPET),
    source,rank,publishedAt:item.publishedDate||item.published_at||item.date||null};
  if(typeof item.engine==="string"&&item.engine.trim())result.engine=item.engine.trim();
  if(Array.isArray(item.engines)){
    const engines=[...new Set(item.engines.filter(engine=>typeof engine==="string").map(engine=>engine.trim()).filter(Boolean))];
    if(engines.length)result.engines=engines;
  }
  if(includeRaw)result.raw=item;
  return result;
}
export function normalizeResults(items,source,options={}) {
  const out=[]; for(const item of items||[]){const r=normalizeSearchResult(item,source,out.length+1,options);if(r)out.push(r);}
  return out;
}
