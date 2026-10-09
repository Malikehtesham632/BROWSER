import {fetchJson} from "./http.js";
import {normalizeResults} from "./normalize.js";
export async function searchSerper(query,apiKey,opts={}) {
  if(!apiKey)throw new Error("SERPER_API_KEY is missing");
  const data=await fetchJson("https://google.serper.dev/search",{provider:"serper",method:"POST",
    headers:{"X-API-KEY":apiKey,"Content-Type":"application/json"},body:JSON.stringify({q:query,num:opts.num??10}),
    timeoutMs:opts.timeoutMs,fetchImpl:opts.fetchImpl});
  return normalizeResults(data.organic,"serper",opts);
}
