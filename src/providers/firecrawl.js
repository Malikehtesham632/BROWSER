import {fetchJson,ProviderError} from "./http.js";
export async function scrapeWithFirecrawl(url,apiKey,opts={}) {
  if(!apiKey)throw new Error("FIRECRAWL_API_KEY is missing");
  const data=await fetchJson("https://api.firecrawl.dev/v2/scrape",{provider:"firecrawl",method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({url,formats:["markdown"]}),timeoutMs:opts.timeoutMs??30000,fetchImpl:opts.fetchImpl});
  if(data.success===false)throw new ProviderError(`firecrawl error: ${String(data.error||"scrape failed").slice(0,200)}`,{provider:"firecrawl"});
  const page=data.data??{},meta=page.metadata??{};
  const out={url,title:meta.title??"",description:meta.description??"",markdown:page.markdown??"",statusCode:meta.statusCode??null};
  if(opts.includeRaw)out.raw=data;
  return out;
}
