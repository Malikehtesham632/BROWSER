import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OmniCrawler } from '../src/crawler/crawler.js';
import { CrawlFrontier } from '../src/crawler/frontier.js';
import { HostLimiter } from '../src/crawler/politeness.js';
import { DocumentStore } from '../src/index/store.js';

function html(title, links = []) {
  const anchors = links.map((href) => `<a href="${href}">link</a>`).join(' ');
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${'word '.repeat(100)}</p>${anchors}</body></html>`;
}

function htmlResponse(body, status = 200, type = 'text/html; charset=utf-8') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: undefined,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body
  };
}

function fakeSite(pages, robots = null) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/robots.txt')) {
      return robots === null ? htmlResponse('', 404) : htmlResponse(robots, 200, 'text/plain');
    }
    const page = pages[url];
    if (!page) return htmlResponse('missing', 404);
    const res = htmlResponse(page.body, page.status ?? 200, page.type);
    res.url = url;
    return res;
  };
  return { fetchImpl, calls };
}

async function setup(
  pages,
  { robots = null, limiter, delayMs = 0, maxConcurrency = 2, store } = {}
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-crawler-'));
  const site = fakeSite(pages, robots);
  const realStore = store ?? new DocumentStore(path.join(dir, 'index.json'));
  await realStore.init();
  const frontier = new CrawlFrontier(path.join(dir, 'frontier.json'));
  const events = [];
  const crawler = new OmniCrawler({
    store: realStore,
    frontier,
    fetchImpl: site.fetchImpl,
    delayMs,
    maxConcurrency,
    limiter: limiter ?? new HostLimiter({ sleep: async () => {} }),
    onEvent: (event) => events.push(event)
  });
  return { crawler, site, store: realStore, frontier, events };
}

const ROOT = 'https://site.test/';

test('pages that link to each other are crawled only once', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/a', '/b']) },
    'https://site.test/a': { body: html('A', ['/', '/b']) },
    'https://site.test/b': { body: html('B', ['/', '/a']) }
  };
  const { crawler, site, store } = await setup(pages);
  const result = await crawler.crawl([ROOT], { maxPages: 20, maxDepth: 5 });
  assert.equal(result.processed, 3);
  assert.equal(store.stats().documents, 3);
  for (const url of Object.keys(pages)) {
    assert.equal(site.calls.filter((call) => call === url).length, 1, url);
  }
});

test('robots.txt blocks pages and is only downloaded once', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/secret', '/a']) },
    'https://site.test/a': { body: html('A') },
    'https://site.test/secret': { body: html('Secret') }
  };
  const { crawler, site, store, frontier } = await setup(pages, {
    robots: 'User-agent: *\nDisallow: /secret\n'
  });
  await crawler.crawl([ROOT], { maxPages: 20, maxDepth: 2 });
  assert.ok(!site.calls.includes('https://site.test/secret'));
  assert.equal(site.calls.filter((call) => call.endsWith('/robots.txt')).length, 1);
  assert.equal(store.stats().documents, 2);
  assert.equal(frontier.get('https://site.test/secret').status, 'failed');
});

test('a missing page and a non-html page fail at once without retries', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/gone', '/file.pdf']) },
    'https://site.test/file.pdf': { body: '%PDF', type: 'application/pdf' }
  };
  const { crawler, site, frontier } = await setup(pages);
  const result = await crawler.crawl([ROOT], { maxPages: 20, maxDepth: 2 });
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 2);
  assert.equal(frontier.get('https://site.test/gone').status, 'failed');
  assert.equal(frontier.get('https://site.test/file.pdf').status, 'failed');
  assert.equal(site.calls.filter((call) => call.endsWith('/gone')).length, 1);
});

test('a temporary server error is retried later, not at once', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/busy']) },
    'https://site.test/busy': { body: 'busy', status: 503 }
  };
  const { crawler, site, frontier } = await setup(pages);
  await crawler.crawl([ROOT], { maxPages: 20, maxDepth: 2 });
  const item = frontier.get('https://site.test/busy');
  assert.equal(item.status, 'retry');
  assert.ok(Date.parse(item.nextCrawlAt) > Date.now());
  assert.equal(site.calls.filter((call) => call.endsWith('/busy')).length, 1);
});

test('a second crawl does not fetch pages again before their recrawl date', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/a']) },
    'https://site.test/a': { body: html('A') }
  };
  const { crawler, site } = await setup(pages);
  await crawler.crawl([ROOT], { maxPages: 20, maxDepth: 2 });
  const before = site.calls.length;
  const second = await crawler.crawl([], { maxPages: 20, maxDepth: 2 });
  assert.equal(second.processed, 0);
  assert.equal(site.calls.length, before);
});

test('starting a crawl with a seed fetches that page again and sees it is unchanged', async () => {
  const pages = { [ROOT]: { body: html('Home') } };
  const { crawler, events } = await setup(pages);
  await crawler.crawl([ROOT], { maxPages: 5, maxDepth: 0 });
  const second = await crawler.crawl([ROOT], { maxPages: 5, maxDepth: 0 });
  assert.equal(second.processed, 1);
  assert.equal(second.changed, 0);
  assert.deepEqual(
    events.map((event) => event.type),
    ['indexed', 'unchanged']
  );
});

test('the crawler waits between requests to the same site using Crawl-delay', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/a', '/b']) },
    'https://site.test/a': { body: html('A') },
    'https://site.test/b': { body: html('B') }
  };
  const sleeps = [];
  const limiter = new HostLimiter({
    now: () => 1000000,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
  const { crawler } = await setup(pages, {
    robots: 'User-agent: *\nCrawl-delay: 3\n',
    limiter,
    maxConcurrency: 1
  });
  await crawler.crawl([ROOT], { maxPages: 10, maxDepth: 2 });
  assert.deepEqual(sleeps, [3000, 6000]);
});

test('the configured delay is used when robots.txt has no Crawl-delay', async () => {
  const pages = {
    [ROOT]: { body: html('Home', ['/a']) },
    'https://site.test/a': { body: html('A') }
  };
  const sleeps = [];
  const limiter = new HostLimiter({
    now: () => 5000,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
  const { crawler } = await setup(pages, { limiter, delayMs: 1500, maxConcurrency: 1 });
  await crawler.crawl([ROOT], { maxPages: 10, maxDepth: 2 });
  assert.deepEqual(sleeps, [1500]);
});

test('the host limiter spaces requests per site and ignores other sites', async () => {
  const sleeps = [];
  const limiter = new HostLimiter({
    now: () => 100,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
  await limiter.wait('a.test', 1000);
  await limiter.wait('a.test', 1000);
  await limiter.wait('a.test', 1000);
  await limiter.wait('b.test', 1000);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('a store error does not leave the page stuck in crawling', async () => {
  const pages = { [ROOT]: { body: html('Home') } };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-badstore-'));
  const store = new DocumentStore(path.join(dir, 'index.json'));
  await store.init();
  store.upsert = async () => {
    throw new Error('disk full');
  };
  const { crawler, frontier } = await setup(pages, { store });
  const result = await crawler.crawl([ROOT], { maxPages: 5, maxDepth: 0 });
  assert.equal(result.failed, 1);
  assert.equal(frontier.get(ROOT).status, 'retry');
});
