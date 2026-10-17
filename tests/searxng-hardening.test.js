import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearxngProvider } from '../src/providers/searxng.js';

const silentLogger = { info() {}, warn() {} };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

test('SearXNG skips an instance during cooldown on the next request', async () => {
  let now = 1000;
  const calls = [];
  const provider = createSearxngProvider(['https://blocked.example', 'https://healthy.example'], {
    retries: 0,
    cooldownMs: 10000,
    now: () => now,
    logger: silentLogger,
    fetchImpl: async (url) => {
      const host = new URL(url).hostname;
      calls.push(host);
      return host === 'blocked.example'
        ? new Response('rate limited', { status: 429 })
        : json({ results: [{ title: 'Working', url: 'https://result.example/' }] });
    }
  });

  await provider.run('first');
  calls.length = 0;
  await provider.run('second');
  assert.deepEqual(calls, ['healthy.example']);

  now += 120001;
  calls.length = 0;
  await provider.run('third');
  assert.ok(calls.includes('blocked.example'));
});

test('SearXNG enforces a hard 2500ms provider budget even when a larger timeout is supplied', async () => {
  const provider = createSearxngProvider(['https://slow.example', 'https://also-slow.example'], {
    timeoutMs: 10000,
    retries: 0,
    logger: silentLogger,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      })
  });

  const started = Date.now();
  await assert.rejects(provider.run('query'), /timed out/);
  assert.ok(Date.now() - started < 3000);
});

test('SearXNG strongly cools down HTTP rate-limit responses', async () => {
  let now = 5000;
  const provider = createSearxngProvider(['https://rate-limited.example', 'https://healthy.example'], {
    retries: 0,
    cooldownMs: 1000,
    now: () => now,
    logger: silentLogger,
    fetchImpl: async (url) =>
      new URL(url).hostname === 'rate-limited.example'
        ? new Response('', { status: 429 })
        : json({ results: [] })
  });

  await provider.run('query');
  const [limited] = provider.health();
  assert.ok(limited.cooldownUntil >= now + 120000);
});
