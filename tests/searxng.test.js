import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSearxng, createSearxngProvider } from '../src/providers/searxng.js';
import { createSearchEngine } from '../src/search.js';
import { fuseResults } from '../src/core/rank.js';

const silentLogger = { info() {}, warn() {} };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

test('SearXNG uses a safely encoded GET request and normalizes result fields and engine metadata', async () => {
  let requested;
  const results = await searchSearxng('python fastapi & "async"', 'https://search.example/', {
    fetchImpl: async (url, init) => {
      requested = { url: new URL(url), init };
      return json({ results: [{
        title: 'Python FastAPI',
        url: 'https://docs.example/python',
        content: 'A framework guide',
        engine: 'brave'
      }] });
    }
  });
  assert.equal(requested.url.pathname, '/search');
  assert.equal(requested.url.searchParams.get('q'), 'python fastapi & "async"');
  assert.equal(requested.url.searchParams.get('format'), 'json');
  assert.equal(requested.init.method, undefined);
  assert.equal(requested.init.headers.Accept, 'application/json');
  assert.deepEqual(results, [{
    url: 'https://docs.example/python',
    title: 'Python FastAPI',
    snippet: 'A framework guide',
    source: 'searxng',
    rank: 1,
    publishedAt: null,
    engine: 'brave'
  }]);
});

test('SearXNG multi-engine metadata survives normalization and result fusion', async () => {
  const normalized = await searchSearxng('python', 'https://search.example', {
    fetchImpl: async () => json({ results: [{
      title: 'Python',
      url: 'https://docs.example/python',
      engines: ['brave', 'google', 'brave']
    }] })
  });
  const [result] = fuseResults([{ source: 'searxng', results: normalized }]);
  assert.deepEqual(result.engines, ['brave', 'google']);
  assert.equal(result.engine, 'brave');
});

test('SearXNG treats a valid empty results array as a successful empty search', async () => {
  assert.deepEqual(await searchSearxng('nothing', 'https://search.example', {
    fetchImpl: async () => json({ results: [] })
  }), []);
});

test('SearXNG rejects malformed JSON and invalid response shapes', async () => {
  await assert.rejects(searchSearxng('query', 'https://search.example', {
    retries: 0,
    fetchImpl: async () => new Response('{broken', { status: 200 })
  }), /invalid JSON/);
  await assert.rejects(searchSearxng('query', 'https://search.example', {
    retries: 0,
    fetchImpl: async () => json({ items: [] })
  }), /expected a results array/);
});

for (const status of [403, 429, 500]) {
  test(`SearXNG handles HTTP ${status} without leaking response content`, async () => {
    let calls = 0;
    await assert.rejects(searchSearxng('private query', 'https://search.example', {
      retries: 0,
      fetchImpl: async () => { calls++; return new Response('private query reflected', { status }); }
    }), error => error.status === status && !error.message.includes('private query'));
    assert.equal(calls, 1);
  });
}

test('SearXNG timeout and connection failures become provider errors', async () => {
  const timeout = new Error('deadline');
  timeout.name = 'TimeoutError';
  await assert.rejects(searchSearxng('query', 'https://search.example', {
    retries: 0,
    fetchImpl: async () => { throw timeout; }
  }), /timed out/);
  await assert.rejects(searchSearxng('query', 'https://search.example', {
    retries: 0,
    fetchImpl: async () => { throw new Error('connection refused'); }
  }), /connection failed/);
});

test('multiple SearXNG instances share one provider timeout budget', async () => {
  const provider = createSearxngProvider(['https://slow-one.example', 'https://slow-two.example'], {
    timeoutMs: 20,
    retries: 0,
    logger: silentLogger,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  const started = Date.now();
  await assert.rejects(provider.run('query'), /timed out/);
  assert.ok(Date.now() - started < 500);
  assert.equal(provider.health()[0].healthy, false);
  assert.equal(provider.health()[1].healthy, null);
});

test('SearXNG retries retryable HTTP failures using the shared HTTP helper', async () => {
  let calls = 0;
  const results = await searchSearxng('query', 'https://search.example', {
    retries: 1,
    fetchImpl: async () => ++calls === 1 ? new Response('', { status: 503 }) : json({ results: [] })
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 2);
});

test('SearXNG records failed and successful instance health and tries configured alternatives', async () => {
  const provider = createSearxngProvider(
    ['https://down.example', 'https://healthy.example'],
    {
      retries: 0,
      logger: silentLogger,
      fetchImpl: async url => new URL(url).hostname === 'down.example'
        ? new Response('disabled', { status: 403 })
        : json({ results: [{ title: 'Working', url: 'https://result.example/' }] })
    }
  );
  const results = await provider.run('query');
  const health = provider.health();
  assert.equal(results.length, 1);
  assert.equal(health[0].healthy, false);
  assert.equal(health[0].failures, 1);
  assert.equal(health[0].consecutiveFailures, 1);
  assert.equal(health[0].lastError, 'searxng HTTP 403');
  assert.equal(health[1].healthy, true);
  assert.equal(health[1].failures, 0);
  assert.equal(health[1].consecutiveFailures, 0);
  assert.ok(health[1].lastSuccessAt);
  assert.ok(health[1].latencyMs >= 0);
});

test('SearXNG provider logs health events without logging queries or response bodies', async () => {
  const messages = [];
  const logger = { info: message => messages.push(message), warn: message => messages.push(message) };
  const provider = createSearxngProvider(['https://private.example'], {
    retries: 0,
    logger,
    fetchImpl: async () => new Response('secret query echoed in upstream error', { status: 403 })
  });
  await assert.rejects(provider.run('secret query'), /HTTP 403/);
  assert.ok(messages.some(message => message.includes('request started')));
  assert.ok(messages.some(message => message.includes('request failed') && message.includes('HTTP 403')));
  assert.ok(messages.every(message => !message.includes('secret query') && !message.includes('echoed')));
});

test('SearXNG and other providers use the shared dedupe and weighted RRF fusion', () => {
  const results = fuseResults([
    { source: 'searxng', results: [
      { url: 'https://example.com/article?utm_source=one', title: 'Article', rank: 1, engine: 'brave' },
      { url: 'https://example.com/article', title: 'Article copy', rank: 2, engine: 'google' }
    ] },
    { source: 'serper', results: [{ url: 'https://example.com/article/', title: 'Article from Serper', rank: 1 }] }
  ], { weights: { searxng: 0.8, serper: 1 }, limit: 10 });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].sources.sort(), ['searxng', 'serper']);
  assert.deepEqual(results[0].engines.sort(), ['brave', 'google']);
  assert.equal(results[0].ranks.serper, 1);
  assert.equal(results[0].ranks.searxng, 1);
});

test('SearXNG failures do not block other providers and use the existing circuit breaker', async () => {
  let failedCalls = 0;
  const logs = [];
  const engine = createSearchEngine({
    providerTimeoutMs: 100,
    cacheTtlMs: 1000,
    scrapeCacheTtlMs: 1000,
    cacheMax: 10,
    breakerThreshold: 1,
    breakerCooldownMs: 60000,
    keys: {},
    weights: {}
  }, {
    logger: { info: message => logs.push(message), warn: message => logs.push(message) },
    providers: [
      { name: 'searxng', run: async () => { failedCalls++; throw new Error('JSON API disabled (HTTP 403)'); } },
      { name: 'healthy-provider', run: async () => [{ url: 'https://healthy.example/result', title: 'Healthy result' }] }
    ]
  });
  const first = await engine.search('test query', { fresh: true });
  assert.ok(first.results.some(result => result.url === 'https://healthy.example/result'));
  assert.equal(first.providers.searxng.ok, false);
  assert.equal(first.providers['healthy-provider'].ok, true);
  assert.equal(engine.providerHealth().searxng.circuitOpen, true);
  assert.equal(engine.providerHealth().searxng.consecutiveFailures, 1);
  assert.ok(logs.some(message => message.includes('[searxng] circuit opened')));
  await engine.search('different query', { fresh: true });
  assert.equal(failedCalls, 1);
});
