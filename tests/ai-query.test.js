import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGeminiClient } from '../src/ai/gemini.js';
import { QueryCorpus } from '../src/queries/corpus.js';
import { createQueryGenerator } from '../src/queries/generator.js';

test('Gemini client parses GenerateContent JSON output without network', async () => {
  const client = createGeminiClient({ ai: { apiKey:'test', model:'test-model', timeoutMs:1000, maxOutputTokens:100 } }, {
    fetchImpl: async () => new Response(JSON.stringify({ candidates:[{content:{parts:[{text:'{\"queries\":[{\"query\":\"FastAPI OAuth\",\"category\":\"backend\",\"intent\":\"informational\"}]}' }]}}] }), { status:200, headers:{'content-type':'application/json'} })
  });
  const out = await client.generateJson({system:'x',user:'y'});
  assert.equal(out.queries[0].query,'FastAPI OAuth');
});

test('query corpus deduplicates case-insensitively and persists', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omni-q-')); const file=path.join(dir,'queries.json');
  const c=new QueryCorpus(file); await c.init();
  assert.equal(await c.addMany(['FastAPI authentication',' fastapi   authentication ','Python asyncio'],{category:'programming'}),2);
  const c2=new QueryCorpus(file); await c2.init(); assert.equal(c2.stats().queries,2); assert.equal(c2.list()[0].source,'user');
});

test('AI query generator stores generated variants', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omni-qg-')); const c=new QueryCorpus(path.join(dir,'queries.json')); await c.init();
  const ai={model:'fake',generateJson:async()=>({queries:[{query:'FastAPI OAuth tutorial',category:'backend',intent:'informational'},{query:'FastAPI JWT authentication',category:'backend',intent:'informational'}]})};
  const g=createQueryGenerator(ai,c); const out=await g.expand('FastAPI authentication',{count:2,category:'backend'});
  assert.equal(out.generated,2); assert.equal(out.added,2); assert.equal(c.stats().queries,2);
});


test('Gemini client retries temporary 503 and succeeds', async () => {
  let calls = 0;
  const client = createGeminiClient({ ai: { apiKey:'test', model:'gemini-3.8-flash', fallbackModels:[], timeoutMs:1000, maxOutputTokens:100, maxRetries:1, retryBaseMs:1 } }, {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({error:{message:'temporarily busy'}}), {status:503});
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"queries":[{"query":"FastAPI JWT","category":"backend","intent":"informational"}]}' }]}}]}), {status:200});
    }
  });
  const out = await client.generateJson({system:'x',user:'y'});
  assert.equal(out.queries[0].query,'FastAPI JWT');
  assert.equal(calls,2);
});

test('Gemini client falls back after repeated temporary failures', async () => {
  const models=[];
  const client = createGeminiClient({ ai: { apiKey:'test', model:'gemini-3.8-flash', fallbackModels:['gemini-3.7-flash'], timeoutMs:1000, maxOutputTokens:100, maxRetries:0 } }, {
    fetchImpl: async url => {
      models.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
      if (models.length === 1) return new Response(JSON.stringify({error:{message:'busy'}}), {status:503});
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"queries":[{"query":"PostgreSQL B-tree index","category":"databases","intent":"informational"}]}' }]}}]}), {status:200});
    }
  });
  const out = await client.generateJson({system:'x',user:'y'});
  assert.equal(out.queries[0].query,'PostgreSQL B-tree index');
  assert.deepEqual(models,['gemini-3.8-flash','gemini-3.7-flash']);
});

test('Gemini cache avoids duplicate API calls', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omni-aicache-')); const file=path.join(dir,'cache.json');
  const { AICache } = await import('../src/ai/cache.js');
  const cache=new AICache(file,{ttlMs:60000,maxEntries:10}); await cache.init();
  let calls=0;
  const client=createGeminiClient({ai:{apiKey:'test',model:'test-model',timeoutMs:1000,maxOutputTokens:100,maxRetries:0}}, { cache, fetchImpl:async()=>{calls++; return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"queries":[{"query":"cached query"}]}' }]}}]}),{status:200});} });
  await client.generateJson({system:'same',user:'same'}); await client.generateJson({system:'same',user:'same'});
  assert.equal(calls,1);
  assert.equal((await cache.get('test-model', 'same', 'same')).queries[0].query,'cached query');
});

test('Gemini circuit breaker skips models after repeated failures', async () => {
  const attempts=[];
  const client=createGeminiClient({ai:{apiKey:'test',model:'m1',fallbackModels:['m2'],timeoutMs:1000,maxOutputTokens:100,maxRetries:0,breakerThreshold:1,breakerCooldownMs:60000}}, { fetchImpl:async url=>{ attempts.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1])); return new Response(JSON.stringify({error:{message:'busy'}}),{status:503}); } });
  await assert.rejects(()=>client.generateJson({system:'a',user:'b'}),e=>e.code==='AI_UNAVAILABLE');
  const before=attempts.length;
  await assert.rejects(()=>client.generateJson({system:'a2',user:'b2'}),e=>e.code==='AI_UNAVAILABLE');
  assert.equal(attempts.length,before);
});

test('query generator gracefully falls back to corpus when Gemini is unavailable', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omni-fallback-')); const c=new QueryCorpus(path.join(dir,'queries.json')); await c.init();
  await c.addMany(['FastAPI OAuth authentication','FastAPI JWT authentication'],{category:'backend'});
  const ai={model:'fake',generateJson:async()=>{const e=new Error('offline');e.code='AI_UNAVAILABLE';throw e;}};
  const g=createQueryGenerator(ai,c); const out=await g.classifyAndExpand('FastAPI authentication',{count:5});
  assert.equal(out.source,'corpus-fallback'); assert.equal(out.aiUnavailable,true); assert.ok(out.fallbackCount>0);
});
