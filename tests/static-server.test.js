import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { WEB_CSP } from '../src/static.js';

const engine = {
  providerNames: () => [],
  indexStats: () => ({ documents: 0 }),
  providerHealth: () => [],
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

async function withServer(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-public-'));
  await fs.mkdir(path.join(dir, 'public'));
  await fs.writeFile(path.join(dir, 'public', 'index.html'), '<!doctype html><title>Nova</title>');
  await fs.writeFile(path.join(dir, 'public', 'app.js'), 'console.log("hi")');
  await fs.writeFile(path.join(dir, 'public', 'app.css'), 'body{}');
  await fs.writeFile(path.join(dir, 'public', '.secret.txt'), 'hidden');
  await fs.writeFile(path.join(dir, 'secret.txt'), 'outside the public folder');
  const config = {
    server: {
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: [],
      apiToken: '',
      rateLimitPerMinute: 1000
    }
  };
  const server = createServer(engine, config, {
    logger: { error() {} },
    publicDir: path.join(dir, 'public')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the web page is served with safe headers', async () => {
  await withServer(async (base) => {
    for (const route of ['/', '/index.html']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.equal(res.headers.get('content-security-policy'), WEB_CSP);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.match(await res.text(), /<title>Nova<\/title>/);
    }
    const script = await fetch(`${base}/app.js`);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.equal(await script.text(), 'console.log("hi")');
    assert.match((await fetch(`${base}/app.css`)).headers.get('content-type'), /text\/css/);
  });
});

test('the page policy blocks inline scripts and framing', () => {
  assert.match(WEB_CSP, /script-src 'self'(;|$)/);
  assert.match(WEB_CSP, /frame-ancestors 'none'/);
  assert.match(WEB_CSP, /object-src 'none'/);
  assert.doesNotMatch(WEB_CSP, /script-src[^;]*unsafe/);
});

test('files outside the public folder and hidden files are never served', async () => {
  await withServer(async (base) => {
    const attempts = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%5csecret.txt',
      '/.secret.txt',
      '/%00.js',
      '/app.js%00.txt'
    ];
    for (const attempt of attempts) {
      const res = await fetch(base + attempt);
      const body = await res.text();
      assert.notEqual(res.status, 200, attempt);
      assert.doesNotMatch(body, /outside the public folder|hidden/, attempt);
    }
  });
});

test('only simple file types are served, and only for GET and HEAD', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/program.exe`)).status, 404);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    const head = await fetch(`${base}/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.notEqual((await fetch(`${base}/app.js`, { method: 'POST' })).status, 200);
  });
});

test('the search API still works next to the web page', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const res = await fetch(`${base}/search?q=python`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).query, 'python');
    assert.equal((await fetch(`${base}/nothing-here`)).status, 404);
  });
});
