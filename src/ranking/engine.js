import {canonicalUrlKey} from '../core/url.js';

const TOKEN_RE=/[a-z0-9][a-z0-9._-]{1,}/g;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const TRUSTED_SUFFIXES=new Set(['gov','edu','org']);
const QUALITY_DOMAINS=new Set(['docs.python.org','fastapi.tiangolo.com','developer.mozilla.org','w3.org','git-scm.com','docs.docker.com','postgresql.org','nodejs.org','react.dev','typescriptlang.org','python.org']);
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function domainQuality(host){if(!host)return 0;if(QUALITY_DOMAINS.has(host))return 1;const tld=host.split('.').at(-1);return TRUSTED_SUFFIXES.has(tld)?.82:.55}
function freshness(publishedAt){if(!publishedAt)return .5;const t=Date.parse(publishedAt);if(!Number.isFinite(t))return .5;const days=Math.max(0,(Date.now()-t)/86400000);return 1/(1+days/365)}
function lexicalFeatures(result,q){const title=String(result.title||'').toLowerCase(),text=String(`${result.title||''} ${result.snippet||''}`).toLowerCase(),terms=[...new Set(q.terms||[])];if(!terms.length)return {coverage:0,titleCoverage:0,phrase:0};let found=0,titleFound=0;for(const term of terms){if(text.includes(term))found++;if(title.includes(term))titleFound++;}return {coverage:found/terms.length,titleCoverage:titleFound/terms.length,phrase:(q.phrases||[]).some(p=>text.includes(String(p).toLowerCase()))?1:0}}
export function rerankResults(results,q,{limit=20}={}){
  const dedup=new Map();
  for(const result of results||[]){const key=canonicalUrlKey(result.url);if(!key)continue;const old=dedup.get(key);if(!old){dedup.set(key,{...result});continue;}const sources=[...new Set([...(old.sources||[]),...(result.sources||[]),old.source,result.source].filter(Boolean))];dedup.set(key,{...old,sources,snippet:String(result.snippet||'').length>String(old.snippet||'').length?result.snippet:old.snippet});}
  const maxBase=Math.max(...[...dedup.values()].map(r=>Number(r.score)||0),0.000001);
  return [...dedup.values()].map(r=>{const f=lexicalFeatures(r,q),providerAgreement=clamp(((r.sources?.length||1)-1)/3,0,1),base=clamp((Number(r.score)||0)/maxBase,0,1),authority=domainQuality(hostOf(r.url)),fresh=freshness(r.publishedAt),penalty=/\b(tag|category|login|signup|privacy|terms)\b/i.test(String(r.title||''))?.05:0;const score=base*.22+f.coverage*.24+f.titleCoverage*.18+f.phrase*.12+authority*.10+providerAgreement*.08+fresh*.06-penalty;return {...r,score,ranking:{baseRelevance:base,termCoverage:f.coverage,titleCoverage:f.titleCoverage,phraseMatch:f.phrase,authority,freshness:fresh,providerAgreement,penalty}};}).sort((a,b)=>b.score-a.score||(b.sources?.length||0)-(a.sources?.length||0)).slice(0,limit);
}
