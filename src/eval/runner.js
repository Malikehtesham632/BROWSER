import fs from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,loadEnvFile} from '../config.js';
import {DocumentStore} from '../index/store.js';
import {createSearchEngine} from '../search.js';
import {aggregateMetrics,evaluateQuery} from './metrics.js';
export async function loadBenchmark(file){return JSON.parse(await fs.readFile(file,'utf8'));}
export async function runBenchmark({benchmarkFile='benchmark/queries.json',config=loadConfig(),engine,limit=10,fresh=true,category=null,intent=null,maxQueries=null}={}){
 const benchmark=await loadBenchmark(benchmarkFile); let queries=benchmark.queries||[];
 if(category)queries=queries.filter(q=>q.category===category); if(intent)queries=queries.filter(q=>q.intent===intent); if(maxQueries)queries=queries.slice(0,maxQueries);
 let owned=false;if(!engine){const store=new DocumentStore(config.indexFile);await store.init();engine=createSearchEngine(config,{store});owned=true;}
 const rows=[];
 for(const q of queries){const started=Date.now();let out,error=null;try{out=await engine.search(q.query,{limit,fresh});}catch(e){error=String(e?.message??e)}
  if(error)rows.push({id:q.id,query:q.query,category:q.category||'uncategorized',intent:q.intent||null,error}); else rows.push(evaluateQuery(out.results,q,{k:limit,latencyMs:Date.now()-started}));
 }
 const good=rows.filter(r=>!r.error), failed=rows.length-good.length;
 return {benchmark:{name:benchmark.name,version:benchmark.version,description:benchmark.description,coverage:benchmark.coverage||null},summary:{...aggregateMetrics(good),failed},queries:rows,generatedAt:new Date().toISOString(),engine:{providers:engine.providerNames(),index:engine.indexStats()}};
}
export async function writeReport(result,file='reports/omni-evaluation.json'){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(result,null,2),'utf8');return file;}
if(process.argv[1]?.endsWith('runner.js')){
 loadEnvFile();const config=loadConfig();const benchmarkFile=process.argv[2]||'benchmark/queries.json';const limit=Number(process.argv[3])||10;const category=process.env.EVAL_CATEGORY||null;const intent=process.env.EVAL_INTENT||null;const maxQueries=Number(process.env.EVAL_MAX_QUERIES)||null;
 const result=await runBenchmark({benchmarkFile,config,limit,fresh:true,category,intent,maxQueries});await writeReport(result);
 console.log(`\nOmni Evaluation Lab`);console.log(`Suite: ${result.benchmark.name}`);console.log(`Queries: ${result.summary.queries} | Failed: ${result.summary.failed}`);
 for(const [k,v] of Object.entries(result.summary))if(!['queries','failed','categorySummary'].includes(k))console.log(`${k}: ${typeof v==='number'?v.toFixed(4):v===null?'n/a':v}`);
 console.log(`Report: reports/omni-evaluation.json`);
 for(const row of result.queries)console.log(row.error?`✗ ${row.query}: ${row.error}`:`✓ ${row.query} | P@K ${row.precisionAtK.toFixed(2)} | MRR ${row.mrr.toFixed(2)} | nDCG ${row.ndcg.toFixed(2)} | ${row.latencyMs}ms`);
}
