import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OmniCrawler } from '../src/crawler/crawler.js';
import { CrawlFrontier } from '../src/crawler/frontier.js';
import { HostLimiter } from '../src/crawler/politeness.js';
import { DocumentStore } from '../src/index/store.js';
import { createSearchEngine } from '../src/search.js';

const filler = 'general words about many other things '.repeat(30);

const PAGES = {
  'https://docs.example/': `<html><head><title>Home</title></head><body><p>${filler}</p>
    <a href="/asyncio">a</a> <a href="/c">b</a> <a href="/urdu">c</a> <a href="/node">d</a> <a href="/rapid">e</a></body></html>`,
  'https://docs.example/asyncio': `<html><head><title>Concurrency</title></head><body><p>${filler} Today we learn asyncio. It is useful.</p></body></html>`,
  'https://docs.example/c': `<html><head><title>Languages</title></head><body><p>${filler} A course on C programming for beginners.</p></body></html>`,
  'https://docs.example/urdu': `<html><head><title>Weather</title></head><body><p>${filler} آج پاکستان کا موسم بہت اچھا ہے</p></body></html>`,
  'https://docs.example/node': `<html><head><title>Runtime</title></head><body><p>${filler} We build servers with Node.js every day.</p></body></html>`,
  'https://docs.example/rapid': `<html><head><title>Rapid therapy</title></head><body><p>${filler} Rapid recovery after surgery.</p></body></html>`
};

function fetchImpl(input) {
  const url = String(input);
  if (url.endsWith('/robots.txt')) return Promise.resolve({ ok: false, status: 404 });
  const body = PAGES[url];
  return Promise.resolve({
    ok: Boolean(body),
    status: body ? 200 : 404,
    url,
    headers: { get: () => 'text/html' },
    text: async () => body || ''
  });
}

async function buildEngine() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-e2e-'));
  const store = new DocumentStore(path.join(dir, 'index.json'));
  await store.init();
  const crawler = new OmniCrawler({
    store,
    frontier: new CrawlFrontier(path.join(dir, 'frontier.json')),
    fetchImpl,
    delayMs: 0,
    limiter: new HostLimiter({ sleep: async () => {} })
  });
  await crawler.crawl(['https://docs.example/'], { maxPages: 20, maxDepth: 2 });
  const config = {
    providerTimeoutMs: 1000,
    cacheTtlMs: 1000,
    scrapeCacheTtlMs: 1000,
    cacheMax: 10,
    breakerThreshold: 3,
    breakerCooldownMs: 1000,
    keys: {},
    searxngUrl: '',
    weights: {},
    ranking: { authorityWeight: 0.04, qualityDomains: [] }
  };
  return { engine: createSearchEngine(config, { providers: [], store }), store };
}

async function topUrl(engine, query) {
  const out = await engine.search(query, { fresh: true, limit: 5 });
  return out.results[0]?.url;
}

test('crawled pages are found with the fixed search rules', async () => {
  const { engine, store } = await buildEngine();
  assert.equal(store.stats().documents, 6);
  assert.equal(await topUrl(engine, 'asyncio'), 'https://docs.example/asyncio');
  assert.equal(await topUrl(engine, 'C programming'), 'https://docs.example/c');
  assert.equal(await topUrl(engine, 'پاکستان کا موسم'), 'https://docs.example/urdu');
  assert.equal(await topUrl(engine, 'node'), 'https://docs.example/node');
  assert.equal(await topUrl(engine, 'node.js'), 'https://docs.example/node');
});

test('a short query word does not match a longer word', async () => {
  const { engine } = await buildEngine();
  const out = await engine.search('api', { fresh: true, limit: 5 });
  assert.equal(out.results.length, 0);
});

test('site filter and phrase queries work on the index', async () => {
  const { engine } = await buildEngine();
  const out = await engine.search('"rapid recovery" site:docs.example', { fresh: true, limit: 5 });
  assert.equal(out.results[0].url, 'https://docs.example/rapid');
  const none = await engine.search('asyncio site:other.example', { fresh: true, limit: 5 });
  assert.equal(none.results.length, 0);
});
