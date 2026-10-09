import {fetchJson} from "./http.js";
import {normalizeResults} from "./normalize.js";
export async function searchSearxng(query,baseUrl,opts={}) {
  if(!baseUrl)throw new Error("SEARXNG_URL is missing");
  const p=new URLSearchParams({q:query,format:"json"});
  const data=await fetchJson(`${baseUrl.replace(/\/+$/,"")}/search?${p}`,{provider:"searxng",timeoutMs:opts.timeoutMs,fetchImpl:opts.fetchImpl});
  return normalizeResults((data.results||[]).slice(0,opts.num??10),"searxng",opts);
}
