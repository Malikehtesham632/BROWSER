import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CrawlFrontier } from '../src/crawler/frontier.js';
import { canCrawl } from '../src/crawler/robots.js';
import { extractDocument } from '../src/index/content.js';
import { DocumentStore } from '../src/index/store.js';
import { createSearchEngine } from '../src/search.js';

test('frontier does not requeue completed pages discovered through crawl cycles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-cycle-'));
  const frontier = new CrawlFrontier(path.join(dir, 'frontier.json'));
  const url = 'https://example.com/a';
  await frontier.enqueue(url);
  const [claimed] = await frontier.claim(1);
  frontier.complete(claimed.key, { nextCrawlAt: new Date(Date.now() + 60_000).toISOString() });

  await frontier.enqueue(url);
  assert.equal((await frontier.claim(1)).length, 0);
  await frontier.enqueue(url, { requeueDone: true });
  assert.equal((await frontier.claim(1)).length, 1);
});

test('frontier honors retry backoff and allows explicitly requeued failed URLs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-retry-'));
  const frontier = new CrawlFrontier(path.join(dir, 'frontier.json'));
  const url = 'https://example.com/retry';
  await frontier.enqueue(url);
  const [claimed] = await frontier.claim(1);
  frontier.fail(claimed.key, new Error('temporary'), { maxAttempts: 2 });

  assert.equal((await frontier.claim(1)).length, 0);
  assert.equal((await frontier.claim(1, Date.now() + 60_000)).length, 1);
  const retry = frontier.get(url);
  frontier.fail(retry.key, new Error('permanent'), { maxAttempts: 2 });
  assert.equal(frontier.get(url).status, 'failed');
  await frontier.enqueue(url);
  assert.equal((await frontier.claim(1)).length, 0);
  await frontier.enqueue(url, { requeueDone: true });
  assert.equal((await frontier.claim(1)).length, 1);
});

test('robots rules use the most specific match and agent group', async () => {
  const robots = [
    'User-agent: *',
    'Disallow: /private',
    'Allow: /private/public',
    'Disallow: /override',
    'Allow: /override$',
    '',
    'User-agent: OmniBot',
    'Disallow: /bot-only'
  ].join('\n');
  const fetchImpl = async () => new Response(robots, { status: 200 });

  const otherBot = { fetchImpl, userAgent: 'OtherBot/1.0' };
  assert.equal(await canCrawl('https://example.com/private/secret', otherBot), false);
  assert.equal(await canCrawl('https://example.com/private/public/page', otherBot), true);
  assert.equal(await canCrawl('https://example.com/override', otherBot), true);
  assert.equal(await canCrawl('https://example.com/bot-only', { fetchImpl }), false);
  assert.equal(
    await canCrawl('https://example.com/bot-only', {
      fetchImpl,
      userAgent: 'OtherBot/1.0'
    }),
    true
  );
});

test('robots fetch failures fail closed while 4xx responses allow crawling', async () => {
  assert.equal(
    await canCrawl('https://example.com/page', {
      fetchImpl: async () => new Response('', { status: 503 })
    }),
    false
  );
  assert.equal(
    await canCrawl('https://example.com/page', {
      fetchImpl: async () => new Response('', { status: 404 })
    }),
    true
  );
  assert.equal(
    await canCrawl('https://example.com/page', {
      fetchImpl: async () => {
        throw new Error('network unavailable');
      }
    }),
    false
  );
});

test('document fingerprint changes when title or links change', () => {
  const first = extractDocument(
    '<html><head><title>Original title</title></head><body><p>Same content.</p><a href="/one">One</a></body></html>',
    'https://example.com/page'
  );
  const changedTitle = extractDocument(
    '<html><head><title>Updated title</title></head><body><p>Same content.</p><a href="/one">One</a></body></html>',
    'https://example.com/page'
  );
  const changedLinks = extractDocument(
    '<html><head><title>Original title</title></head><body><p>Same content.</p><a href="/two">Two</a></body></html>',
    'https://example.com/page'
  );
  assert.notEqual(first.hash, changedTitle.hash);
  assert.notEqual(first.hash, changedLinks.hash);
});

test('indexed search supports quoted-only queries and invalidates on content updates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-index-search-'));
  const store = new DocumentStore(path.join(dir, 'index.json'));
  await store.init();
  const first = {
    url: 'https://example.com/guide',
    title: 'FastAPI authentication guide',
    description: '',
    headings: [],
    content: 'Learn FastAPI authentication with OAuth.',
    wordCount: 6,
    hash: 'first',
    indexedAt: new Date().toISOString()
  };
  await store.upsert(first);
  const config = {
    providerTimeoutMs: 1000,
    cacheTtlMs: 60_000,
    scrapeCacheTtlMs: 60_000,
    cacheMax: 10,
    breakerThreshold: 3,
    breakerCooldownMs: 1000,
    keys: {},
    searxngUrl: '',
    weights: {}
  };
  const engine = createSearchEngine(config, { providers: [], store });

  const phraseResult = await engine.search('"FastAPI authentication"');
  assert.equal(phraseResult.results[0].url, first.url);

  const initialResult = await engine.search('FastAPI authentication');
  assert.equal(initialResult.cached, false);
  const cachedResult = await engine.search('FastAPI authentication');
  assert.equal(cachedResult.cached, true);
  await store.upsert({
    ...first,
    title: 'Updated FastAPI authentication',
    content: 'FastAPI authentication with new OAuth guidance.',
    hash: 'second'
  });
  const refreshed = await engine.search('FastAPI authentication');
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.results[0].title, 'Updated FastAPI authentication');
});
