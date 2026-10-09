export class ProviderError extends Error {
  constructor(message,{provider="provider",status=null,retryable=false}={}) {
    super(message); this.name="ProviderError"; this.provider=provider; this.status=status; this.retryable=retryable;
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function fetchJson(url,{provider="provider",timeoutMs=4000,retries=1,maxTotalMs=null,fetchImpl=globalThis.fetch,includeErrorBody=true,...init}={}) {
  let last;
  const deadline=Number.isFinite(maxTotalMs)?Date.now()+Math.max(1,maxTotalMs):Infinity;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new ProviderError(`${provider} timed out after ${maxTotalMs}ms`,{provider});
      const requestTimeout=Math.max(1,Math.min(timeoutMs,remaining));
      const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(requestTimeout)});
      if(res.ok){
        try{return await res.json();}
        catch{throw new ProviderError(`${provider} returned invalid JSON`,{provider});}
      }
      const body=includeErrorBody?(await res.text()).slice(0,300):"";
      throw new ProviderError(`${provider} HTTP ${res.status}${body?`: ${body}`:""}`,{provider,status:res.status,retryable:res.status===429||res.status>=500});
    }catch(err){
      const e=err instanceof ProviderError?err:new ProviderError(
        err?.name==="TimeoutError"||err?.name==="AbortError"?`${provider} timed out after ${timeoutMs}ms`:`${provider} connection failed`,{provider,retryable:true});
      last=e;
      if(!e.retryable || attempt===retries)throw e;
      const delay=150*2**attempt;
      if(Date.now()+delay>=deadline)throw e;
      await sleep(delay);
    }
  }
  throw last;
}
