export class ProviderError extends Error {
  constructor(message,{provider="provider",status=null,retryable=false}={}) {
    super(message); this.name="ProviderError"; this.provider=provider; this.status=status; this.retryable=retryable;
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function fetchJson(url,{provider="provider",timeoutMs=4000,retries=1,fetchImpl=globalThis.fetch,...init}={}) {
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
      if(res.ok)return await res.json();
      const body=(await res.text()).slice(0,300);
      throw new ProviderError(`${provider} HTTP ${res.status}: ${body}`,{provider,status:res.status,retryable:res.status===429||res.status>=500});
    }catch(err){
      const e=err instanceof ProviderError?err:new ProviderError(
        err?.name==="TimeoutError"?`${provider} timed out after ${timeoutMs}ms`:`${provider} request failed: ${err?.message??err}`,{provider});
      last=e;
      if(!e.retryable || attempt===retries)throw e;
      await sleep(150*2**attempt);
    }
  }
  throw last;
}
