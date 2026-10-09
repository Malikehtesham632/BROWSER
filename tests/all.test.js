import test from 'node:test';import assert from 'node:assert/strict';import {canonicalUrlKey} from '../src/core/url.js';import {TTLCache} from '../src/core/cache.js';import {CircuitBreaker} from '../src/core/circuit.js';import {fuseResults} from '../src/core/rank.js';import {analyzeQuery} from '../src/query/analyzer.js';import {extractDocument} from '../src/index/content.js';import {DocumentStore} from '../src/index/store.js';import {rankIndexed} from '../src/index/rank.js';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('canonical URL removes tracking and sorts query',()=>assert.equal(canonicalUrlKey('https://WWW.Example.com/a/?utm_source=x&b=2&a=1'),'example.com/a?a=1&b=2'));
test('TTL cache expires',async()=>{const c=new TTLCache({ttlMs:10,max:2});c.set('x',1);assert.equal(c.get('x'),1);await new Promise(r=>setTimeout(r,15));assert.equal(c.get('x'),undefined)});
test('circuit breaker opens',()=>{const b=new CircuitBreaker({threshold:2,cooldownMs:1000});b.failure('x');b.failure('x');assert.equal(b.isOpen('x'),true);b.success('x');assert.equal(b.isOpen('x'),false)});
test('RRF dedupes provider overlap',()=>{const r=fuseResults([{source:'a',results:[{url:'https://x.com/'}]},{source:'b',results:[{url:'https://x.com/?utm_source=z'},{url:'https://y.com'}]}]);assert.equal(r.length,2);assert.equal(r[0].url,'https://x.com/')});
test('query analyzer extracts site and phrase',()=>{const q=analyzeQuery('"fast api" tutorial site:python.org');assert.deepEqual(q.phrases,['fast api']);assert.equal(q.site,'python.org');assert.equal(q.intent,'informational')});
test('content extraction builds searchable document',()=>{const d=extractDocument('<html><head><title>Fast API Guide</title></head><body><h1>Fast API</h1><p>Build an API quickly.</p><a href="/next">Next</a></body></html>','https://example.com/start');assert.equal(d.title,'Fast API Guide');assert.ok(d.content.includes('Build an API'));assert.equal(d.links[0],'https://example.com/next');assert.ok(d.hash)});
test('persistent document store and BM25 ranking',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'omni-'));const file=path.join(dir,'index.json');const s=new DocumentStore(file);await s.init();await s.upsert({url:'https://a.com',canonical:'https://a.com',title:'FastAPI authentication',description:'OAuth authentication guide',headings:[],content:'FastAPI authentication with OAuth tokens',wordCount:6,indexedAt:new Date().toISOString()});await s.upsert({url:'https://b.com',canonical:'https://b.com',title:'Cooking guide',description:'Recipes',headings:[],content:'Pasta and sauce',wordCount:4,indexedAt:new Date().toISOString()});await s.flush();const s2=new DocumentStore(file);await s2.init();const r=rankIndexed(s2.candidates(['fastapi','authentication']),analyzeQuery('FastAPI authentication'));assert.equal(r[0].url,'https://a.com');assert.equal(s2.stats().documents,2)});
import {createSearchEngine} from '../src/search.js';

test('search pipeline reranks fused provider results',async()=>{
 const config={providerTimeoutMs:1000,cacheTtlMs:1000,scrapeCacheTtlMs:1000,cacheMax:10,breakerThreshold:3,breakerCooldownMs:1000,keys:{},searxngUrl:'',weights:{}};
 const providers=[{name:'fake',tier:'primary',run:async()=>[
  {url:'https://noise.example/article',title:'General programming',snippet:'Programming overview',score:1},
  {url:'https://docs.docker.com/guides/fastapi/',title:'FastAPI deployment with Docker',snippet:'Deploy FastAPI with Docker',score:.6}
 ]}];
 const engine=createSearchEngine(config,{providers});
 const out=await engine.search('Docker FastAPI deployment',{fresh:true,limit:2});
 assert.equal(out.results[0].url,'https://docs.docker.com/guides/fastapi/');
 assert.ok(out.results[0].ranking.titleCoverage>0);
});
