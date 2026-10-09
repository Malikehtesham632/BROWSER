import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateQuery,aggregateMetrics} from '../src/eval/metrics.js';

test('evaluation metrics identify relevant result and rank position',()=>{
 const r=evaluateQuery([{url:'https://bad.example/x'},{url:'https://docs.python.org/3/library/asyncio.html'}],{query:'asyncio',relevantDomains:['docs.python.org'],relevantUrls:[]},{k:2,latencyMs:12});
 assert.equal(r.precisionAtK,.5); assert.equal(r.mrr,.5); assert.equal(r.duplicateRate,0); assert.equal(r.latencyMs,12); assert.ok(r.ndcg>=0&&r.ndcg<=1);
});
test('evaluation detects canonical duplicates',()=>{
 const r=evaluateQuery([{url:'https://example.com/?utm_source=x'},{url:'https://example.com/'}],{query:'x',relevantDomains:['example.com'],relevantUrls:[]},{k:2});
 assert.equal(r.duplicateRate,.5);
});
test('nDCG is bounded even when many results match a domain',()=>{
 const r=evaluateQuery(Array.from({length:10},(_,i)=>({url:`https://example.org/${i}`})),{query:'x',relevantDomains:['example.org'],relevantUrls:[]},{k:10});
 assert.equal(r.ndcg,1);assert.ok(r.ndcg<=1);
});
test('aggregate metrics average query scores',()=>{const a=aggregateMetrics([{precisionAtK:1,recallAtK:1,mrr:1,ndcg:1,duplicateRate:0,latencyMs:10},{precisionAtK:0,recallAtK:0,mrr:0,ndcg:0,duplicateRate:1,latencyMs:30}]);assert.equal(a.queries,2);assert.equal(a.precisionAtK,.5);assert.equal(a.averageLatencyMs,20)});


test('domain-only judgments never report false exhaustive recall',()=>{
 const r=evaluateQuery([{url:'https://docs.python.org/x'}],{query:'x',relevantDomains:['docs.python.org'],relevantUrls:[]},{k:10});
 assert.equal(r.recallAtK,null); assert.equal(r.evaluationMode,'domain-density'); assert.equal(r.relevanceCoverageAtK,1);
});
test('explicit relevance judgments produce real recall',()=>{
 const r=evaluateQuery([{url:'https://a.example/x'},{url:'https://b.example/y'}],{query:'x',relevanceByUrl:{'https://a.example/x':3,'https://b.example/y':1,'https://c.example/z':2}},{k:2});
 assert.equal(r.recallAtK,2/3); assert.ok(r.ndcg>0&&r.ndcg<=1); assert.equal(r.evaluationMode,'exhaustive-judgment');
});
test('metrics stay bounded',()=>{
 const r=evaluateQuery(Array.from({length:20},(_,i)=>({url:`https://docs.example/${i}`})),{query:'x',relevantDomains:['docs.example'],relevantUrls:[]},{k:10});
 for(const k of ['precisionAtK','mrr','ndcg','duplicateRate','relevanceCoverageAtK'])assert.ok(r[k]>=0&&r[k]<=1);
});
