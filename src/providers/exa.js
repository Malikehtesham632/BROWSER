import {fetchJson} from "./http.js";
import {normalizeResults} from "./normalize.js";
export async function searchExa(query,apiKey,opts={}) {
  if(!apiKey)throw new Error("EXA_API_KEY is missing");
  const data=await fetchJson("https://api.exa.ai/search",{provider:"exa",method:"POST",
    headers:{"x-api-key":apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({query,numResults:opts.num??10,contents:{highlights:{maxCharacters:500}}}),
    timeoutMs:opts.timeoutMs,fetchImpl:opts.fetchImpl});
  return normalizeResults(data.results,"exa",opts);
}
