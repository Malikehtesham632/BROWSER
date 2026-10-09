import test from 'node:test';
import assert from 'node:assert/strict';
import browserUrl from '../desktop/browser-url.cjs';

const { normalizeBrowserAddress } = browserUrl;

test('browser address accepts HTTP(S) destinations and adds HTTPS to bare hosts', () => {
  assert.equal(normalizeBrowserAddress('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizeBrowserAddress('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(normalizeBrowserAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserAddress('localhost:8787'), 'https://localhost:8787/');
});

test('browser address rejects unsafe schemes and embedded credentials', () => {
  assert.equal(normalizeBrowserAddress('javascript:alert(1)'), null);
  assert.equal(normalizeBrowserAddress('file:///C:/secret.txt'), null);
  assert.equal(normalizeBrowserAddress('https://user:password@example.com'), null);
  assert.equal(normalizeBrowserAddress('not a url'), null);
});
