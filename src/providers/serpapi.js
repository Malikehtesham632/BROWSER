import {fetchJson,ProviderError} from "./http.js";
import {normalizeResults} from "./normalize.js";
export async function searchSerpApi(query,apiKey,opts={}) {
  if(!apiKey)throw new Error("SERPAPI_API_KEY is missing");
  const params=new URLSearchParams({engine:"google",q:query,num:String(opts.num??10),api_key:apiKey});
  const data=await fetchJson(`https://serpapi.com/search.json?${params}`,{provider:"serpapi",timeoutMs:opts.timeoutMs,fetchImpl:opts.fetchImpl});
  if(data.error)throw new ProviderError(`serpapi error: ${String(data.error).slice(0,200)}`,{provider:"serpapi"});
  return normalizeResults(data.organic_results,"serpapi",opts);
}
