import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, securityProblem } from '../src/server.js';

function makeConfig(overrides = {}) {
  return {
    server: {
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: [],
      apiToken: '',
      rateLimitPerMinute: 3,
      ...overrides
    }
  };
}

const engine = {
  providerNames: () => ['fake'],
  indexStats: () => ({ documents: 0 }),
  search: async (query) => ({
    query,
    analysis: {},
    results: [],
    providers: {},
    cached: false,
    tookMs: 1
  }),
  scrape: async () => ({})
};

async function withServer(config, run) {
  const server = createServer(engine, config, { logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('server refuses a public host without a token', () => {
  assert.match(securityProblem(makeConfig({ host: '0.0.0.0' })), /OMNI_API_TOKEN/);
  assert.match(securityProblem(makeConfig({ host: '192.168.1.5' })), /OMNI_API_TOKEN/);
});

test('server allows local hosts without a token', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '127.1.2.3']) {
    assert.equal(securityProblem(makeConfig({ host })), null, host);
  }
});

test('server allows a public host when a token is set', () => {
  assert.equal(securityProblem(makeConfig({ host: '0.0.0.0', apiToken: 'secret' })), null);
});

test('health is open but search needs the token', async () => {
  await withServer(makeConfig({ apiToken: 'secret', rateLimitPerMinute: 100 }), async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/search?q=test`)).status, 401);
    const wrong = await fetch(`${base}/search?q=test`, {
      headers: { Authorization: 'Bearer nope' }
    });
    assert.equal(wrong.status, 401);
    const good = await fetch(`${base}/search?q=test`, {
      headers: { Authorization: 'Bearer secret' }
    });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).query, 'test');
  });
});

test('too many requests get a 429', async () => {
  await withServer(makeConfig({ rateLimitPerMinute: 3 }), async (base) => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await fetch(`${base}/search?q=test`)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });
});

test('empty query, unknown path and wrong method are rejected', async () => {
  await withServer(makeConfig({ rateLimitPerMinute: 100 }), async (base) => {
    assert.equal((await fetch(`${base}/search?q=`)).status, 400);
    assert.equal((await fetch(`${base}/nothing`)).status, 404);
    assert.equal((await fetch(`${base}/search?q=test`, { method: 'POST' })).status, 405);
  });
});

test('generation endpoints say they are not configured when Gemini is off', async () => {
  await withServer(makeConfig({ rateLimitPerMinute: 100 }), async (base) => {
    assert.equal((await fetch(`${base}/queries/generate?seed=x`)).status, 503);
    assert.equal((await fetch(`${base}/queries/smart?q=x`)).status, 503);
  });
});

test('desktop browser shell and assets are served from the same local origin', async () => {
  await withServer(makeConfig({ rateLimitPerMinute: 100 }), async (base) => {
    const html = await fetch(`${base}/browser`);
    assert.equal(html.status, 200);
    const markup = await html.text();
    assert.match(markup, /href="\/browser\/style\.css"/);
    assert.match(markup, /src="\/browser\/app\.js"/);
    assert.equal((await fetch(`${base}/browser/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/browser/style.css`)).status, 200);
  });
});
