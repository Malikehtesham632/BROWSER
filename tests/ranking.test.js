import test from 'node:test';
import assert from 'node:assert/strict';
import {rerankResults} from '../src/ranking/engine.js';

test('ranking promotes title and phrase relevance',()=>{
 const q={terms:['docker','fastapi','deployment'],phrases:['FastAPI deployment']};
 const results=[
  {url:'https://example.com/noise',title:'Random programming article',snippet:'general programming',score:.9,sources:['serper']},
  {url:'https://docs.docker.com/guides/fastapi/',title:'FastAPI deployment with Docker',snippet:'Deploy a FastAPI application with Docker.',score:.5,sources:['serper','exa']}
 ];
 const out=rerankResults(results,q,{limit:2});
 assert.equal(out[0].url,'https://docs.docker.com/guides/fastapi/');
 assert.ok(out[0].ranking.titleCoverage>0);
});

test('ranking deduplicates canonical URLs',()=>{
 const out=rerankResults([{url:'https://example.com/?utm_source=x',title:'A',score:1},{url:'https://example.com/',title:'A better title',score:.9}],{terms:['a'],phrases:[]},{limit:10});
 assert.equal(out.length,1);
});
