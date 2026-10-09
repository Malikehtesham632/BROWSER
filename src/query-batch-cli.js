import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadEnvFile } from './config.js';
import { createGeminiClient } from './ai/gemini.js';
import { AICache } from './ai/cache.js';
import { QueryCorpus } from './queries/corpus.js';
import { createQueryGenerator } from './queries/generator.js';

loadEnvFile();
const config=loadConfig();
const flag=name=>{const a=process.argv.slice(2),i=a.indexOf(name);return i>=0?a[i+1]:undefined;};
const file=flag('--file');
if(!file) throw new Error('Usage: npm run query:batch -- --file seeds.txt --count 20 --max-calls 50');
let raw;
try { raw=await fs.readFile(file,'utf8'); } catch(e) { if(e.code==='ENOENT'){ console.error(`Seed file not found: ${file}`); console.error('Create a newline-delimited seeds.txt, or copy seeds.example.txt to seeds.txt.'); process.exitCode=2; } throw e; }
let seeds;
try { const parsed=JSON.parse(raw); seeds=Array.isArray(parsed)?parsed.map(x=>typeof x==='string'?x:x?.query).filter(Boolean):[]; } catch { seeds=raw.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')); }
const maxCalls=Math.max(1,Math.min(seeds.length,Number(flag('--max-calls'))||seeds.length));
const count=Math.max(1,Math.min(100,Number(flag('--count'))||20));
const category=flag('--category')||'general'; const intent=flag('--intent')||'mixed';
const delayMs=Math.max(0,Number(flag('--delay-ms'))||750);
const stateFile=path.resolve(flag('--state-file')||'data/query-batch-state.json');
const resume=!['false','0','no'].includes(String(flag('--resume')||'true').toLowerCase());
const corpus=new QueryCorpus(config.ai.corpusFile); await corpus.init();
const cache=new AICache(config.ai.cacheFile,{ttlMs:config.ai.cacheTtlMs,maxEntries:config.ai.cacheMaxEntries}); await cache.init();
const generator=createQueryGenerator(createGeminiClient(config,{cache}),corpus);
let state={version:1,file:path.resolve(file),updatedAt:null,seeds:{}};
try { state=JSON.parse(await fs.readFile(stateFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; }
console.log(`Omni Query Batch: ${maxCalls} seed(s), up to ${count} variants/seed`);
for(let i=0;i<maxCalls;i++){
  const seed=seeds[i]; const prior=state.seeds?.[seed];
  if(resume && prior?.status==='success' && prior.count===count && prior.category===category && prior.intent===intent){ console.log(`[${i+1}/${maxCalls}] ${seed} -> SKIP (already completed)`); continue; }
  const started=Date.now();
  try {
    const out=await generator.expand(seed,{count,category,intent});
    state.seeds[seed]={status:out.aiUnavailable?'deferred':'success',count,category,intent,generated:out.generated,added:out.added,attempts:(prior?.attempts||0)+1,lastError:out.aiUnavailable?out.warning:null,updatedAt:new Date().toISOString()};
    console.log(`[${i+1}/${maxCalls}] ${seed} -> ${out.aiUnavailable?'DEFERRED':'generated '+out.generated+', added '+out.added}${out.aiUnavailable?` | corpus fallback ${out.fallbackCount}`:''}`);
  } catch(e) {
    state.seeds[seed]={status:'failed',count,category,intent,generated:0,added:0,attempts:(prior?.attempts||0)+1,lastError:e.message,updatedAt:new Date().toISOString()};
    console.error(`[${i+1}/${maxCalls}] ${seed} -> ERROR: ${e.message}`);
  }
  state.updatedAt=new Date().toISOString(); await fs.mkdir(path.dirname(stateFile),{recursive:true}); await fs.writeFile(`${stateFile}.tmp`,JSON.stringify(state,null,2),'utf8'); await fs.rename(`${stateFile}.tmp`,stateFile);
  if(i<maxCalls-1 && delayMs) await new Promise(r=>setTimeout(r,delayMs));
}
console.log(JSON.stringify({...corpus.stats(),batchState:stateFile},null,2));
