import {canonicalUrlKey} from '../core/url.js';
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function domainMatch(host,d){const x=String(d).toLowerCase().replace(/^www\./,'');return host===x||host.endsWith(`.${x}`)}
function relevanceGrade(result,expected){
 const key=canonicalUrlKey(result.url);
 if(expected.relevanceByUrl){for(const [u,v] of Object.entries(expected.relevanceByUrl))if(canonicalUrlKey(u)===key)return Math.max(0,Math.min(3,Number(v)||0));}
 if(expected.relevantUrls?.some(u=>canonicalUrlKey(u)===key))return 1;
 const host=hostOf(result.url);
 if(expected.relevantDomains?.some(d=>domainMatch(host,d)))return 1;
 return 0;
}
function idealGrades(expected,k){
 if(expected.relevanceByUrl)return Object.values(expected.relevanceByUrl).map(v=>Math.max(0,Math.min(3,Number(v)||0))).filter(Boolean).sort((a,b)=>b-a).slice(0,k);
 if(Number.isInteger(expected.relevantCount))return Array.from({length:Math.min(k,Math.max(0,expected.relevantCount))},()=>1);
 if(expected.relevantUrls?.length)return Array.from({length:Math.min(k,expected.relevantUrls.length)},()=>1);
 // Domain judgments are not exhaustive. Use K as the ideal only for the bounded
 // ranking-density metric; do not expose this as exhaustive recall.
 if(expected.relevantDomains?.length)return Array.from({length:k},()=>1);
 return [];
}
function dcg(grades){return grades.reduce((s,g,i)=>s+(2**g-1)/Math.log2(i+2),0)}
export function evaluateQuery(results,expected,{k=10,latencyMs=0}={}){
 const top=(results||[]).slice(0,k), grades=top.map(r=>relevanceGrade(r,expected)), hits=grades.map(g=>g>0), relevantSeen=hits.filter(Boolean).length, first=hits.findIndex(Boolean);
 const ideal=idealGrades(expected,k), idcg=dcg(ideal), ndcg=idcg?Math.min(1,dcg(grades)/idcg):0;
 const duplicateCount=top.length-new Set(top.map(r=>canonicalUrlKey(r.url))).size;
 const exhaustive=Number.isInteger(expected.relevantCount)||Boolean(expected.relevanceByUrl)||Boolean(expected.relevantUrls?.length);
 const totalRelevant=Number.isInteger(expected.relevantCount)?expected.relevantCount:(expected.relevanceByUrl?Object.values(expected.relevanceByUrl).filter(v=>Number(v)>0).length:(expected.relevantUrls?.length||null));
 return {
  query:expected.query,id:expected.id,category:expected.category||'uncategorized',intent:expected.intent||null,k,results:top.length,relevantSeen,
  precisionAtK:relevantSeen/Math.max(1,top.length),
  recallAtK:exhaustive&&totalRelevant>0?Math.min(1,relevantSeen/totalRelevant):null,
  relevanceCoverageAtK:expected.relevantDomains?.length?relevantSeen/Math.max(1,top.length):null,
  mrr:first<0?0:1/(first+1),ndcg,duplicateRate:duplicateCount/Math.max(1,top.length),latencyMs,
  evaluationMode:exhaustive?'exhaustive-judgment':'domain-density'
 };
}
export function aggregateMetrics(rows){
 const avg=k=>{const v=rows.map(r=>r[k]).filter(x=>typeof x==='number'&&Number.isFinite(x));return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
 const byCategory={}; for(const r of rows){const c=r.category||'uncategorized';(byCategory[c]??=[]).push(r)}
 const categorySummary=Object.fromEntries(Object.entries(byCategory).map(([c,rs])=>[c,{queries:rs.length,precisionAtK:avgKey(rs,'precisionAtK'),recallAtK:avgKey(rs,'recallAtK'),mrr:avgKey(rs,'mrr'),ndcg:avgKey(rs,'ndcg'),relevanceCoverageAtK:avgKey(rs,'relevanceCoverageAtK'),latencyMs:avgKey(rs,'latencyMs')} ]));
 return {queries:rows.length,precisionAtK:avg('precisionAtK'),recallAtK:avg('recallAtK'),mrr:avg('mrr'),ndcg:avg('ndcg'),relevanceCoverageAtK:avg('relevanceCoverageAtK'),duplicateRate:avg('duplicateRate'),averageLatencyMs:avg('latencyMs'),categorySummary};
}
function avgKey(rows,key){const v=rows.map(r=>r[key]).filter(x=>typeof x==='number'&&Number.isFinite(x));return v.length?v.reduce((s,x)=>s+x,0)/v.length:null}
