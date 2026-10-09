import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchEngine, buildProviders } from '../src/search.js';

const config = {
  providerTimeoutMs: 1000,
  cacheTtlMs: 1000,
  scrapeCacheTtlMs: 1000,
  cacheMax: 20,
  breakerThreshold: 3,
  breakerCooldownMs: 1000,
  keys: {
    serper: 'test-serper-key',
    serpapi: 'test-serpapi-key',
    exa: 'test-exa-key'
  },
  searxngUrl: 'https://search.example'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('all configured web-search integrations run and return usable results', async () => {
  const called = new Set();
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname;
    called.add(host);
    if (host === 'google.serper.dev') {
      return jsonResponse({
        organic: [{ link: 'https://serper.example/python', title: 'Python from Serper' }]
      });
    }
    if (host === 'serpapi.com') {
      return jsonResponse({
        organic_results: [{ link: 'https://serpapi.example/python', title: 'Python from SerpApi' }]
      });
    }
    if (host === 'api.exa.ai') {
      return jsonResponse({
        results: [{ url: 'https://exa.example/python', title: 'Python from Exa' }]
      });
    }
    if (host === 'search.example') {
      return jsonResponse({
        results: [{ url: 'https://searxng.example/python', title: 'Python from SearXNG' }]
      });
    }
    throw new Error(`Unexpected provider host: ${host}`);
  };
  const providers = buildProviders(config, fetchImpl);
  assert.deepEqual(
    providers.map((provider) => provider.name),
    ['serper', 'serpapi', 'exa', 'searxng']
  );
  const engine = createSearchEngine(config, { fetchImpl });
  const result = await engine.search('Python', { fresh: true, limit: 10 });
  assert.deepEqual([...called].sort(), ['api.exa.ai', 'google.serper.dev', 'search.example', 'serpapi.com']);
  assert.equal(result.results.length, 4);
  assert.equal(result.providers.serper.ok, true);
  assert.equal(result.providers.serpapi.ok, true);
  assert.equal(result.providers.exa.ok, true);
  assert.equal(result.providers.searxng.ok, true);
});

test('provider responses report real incremental results to the caller', async () => {
  const providers = [
    {
      name: 'fast-provider',
      run: async () => [{ url: 'https://fast.example/python', title: 'Python overview' }]
    },
    {
      name: 'slow-provider',
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [{ url: 'https://slow.example/python', title: 'Python guide' }];
      }
    }
  ];
  const engine = createSearchEngine(config, { providers });
  const updates = [];
  await engine.search('Python', {
    fresh: true,
    onProvider: (update) => updates.push(update)
  });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].provider.name, 'fast-provider');
  assert.equal(updates[0].provider.ok, true);
  assert.equal(updates[0].provider.count, 1);
  assert.deepEqual(
    updates[0].results.map((result) => result.url),
    ['https://fast.example/python']
  );
  assert.deepEqual(
    new Set(updates[1].results.map((result) => result.url)),
    new Set(['https://fast.example/python', 'https://slow.example/python'])
  );
});

test('SearXNG participates in parallel search and healthy providers survive provider failures', async () => {
  const called = new Set();
  const fetchImpl = async (url) => {
    const host = new URL(url).hostname;
    called.add(host);
    if (host === 'google.serper.dev')
      return jsonResponse({ error: { message: 'upstream failure' } }, 503);
    if (host === 'serpapi.com') {
      return jsonResponse({
        organic_results: [{ link: 'https://healthy.example/python', title: 'Python search result' }]
      });
    }
    if (host === 'api.exa.ai') return jsonResponse({ results: [] });
    if (host === 'search.example') {
      return jsonResponse({
        results: [{ url: 'https://fallback.example/python', title: 'Python fallback result' }]
      });
    }
    throw new Error(`Unexpected provider host: ${host}`);
  };
  const engine = createSearchEngine(config, { fetchImpl });
  const result = await engine.search('Python', { fresh: true, limit: 10 });
  assert.ok(result.results.some((item) => item.url === 'https://healthy.example/python'));
  assert.ok(result.results.some((item) => item.url === 'https://fallback.example/python'));
  assert.ok(called.has('google.serper.dev'));
  assert.ok(called.has('serpapi.com'));
  assert.ok(called.has('api.exa.ai'));
  assert.ok(called.has('search.example'));
  assert.equal(result.providers.serper.ok, false);
  assert.equal(result.providers.serpapi.ok, true);
  assert.equal(result.providers.exa.ok, true);
  assert.equal(result.providers.searxng.ok, true);
});
