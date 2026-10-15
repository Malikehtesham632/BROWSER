import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../src/providers/http.js';
import { createSearxngProvider } from '../src/providers/searxng.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' }
});

test('shared HTTP helper retries a transient connection reset once', async () => {
  let calls = 0;
  const body = await fetchJson('https://example.invalid/search', {
    provider: 'test-provider',
    retries: 1,
    retryBaseMs: 1,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'ECONNRESET' };
        throw error;
      }
      return json({ ok: true });
    }
  });
  assert.deepEqual(body, { ok: true });
  assert.equal(calls, 2);
});

test('HTTP provider errors do not include upstream response bodies', async () => {
  await assert.rejects(
    fetchJson('https://example.invalid/search', {
      provider: 'test-provider',
      retries: 0,
      fetchImpl: async () => new Response('private query reflected in error', { status: 403 })
    }),
    error => error.status === 403 && /HTTP 403/.test(error.message) && !/private query|reflected/.test(error.message)
  );
});

test('SearXNG tries a healthy configured alternative after an HTTP failure', async () => {
  const provider = createSearxngProvider(
    ['https://down.example', 'https://healthy.example'],
    {
      retries: 0,
      logger: { info() {}, warn() {} },
      fetchImpl: async url => new URL(url).hostname === 'down.example'
        ? new Response('service unavailable', { status: 403 })
        : json({ results: [{ title: 'Healthy result', url: 'https://results.example/item' }] })
    }
  );
  const results = await provider.run('test query');
  assert.equal(results.length, 1);
  assert.equal(provider.health()[0].healthy, false);
  assert.equal(provider.health()[1].healthy, true);
});
