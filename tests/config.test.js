import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function withEnv(values, run) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('empty or invalid numbers fall back to defaults', () => {
  const config = withEnv(
    { CRAWLER_DELAY_MS: '', PORT: 'abc', CRAWLER_CONCURRENCY: '  ' },
    loadConfig
  );
  assert.equal(config.crawler.delayMs, 1000);
  assert.equal(config.server.port, 8787);
  assert.equal(config.crawler.maxConcurrency, 4);
});

test('a real zero is kept', () => {
  const config = withEnv({ CRAWLER_DELAY_MS: '0', RANK_AUTHORITY_WEIGHT: '0' }, loadConfig);
  assert.equal(config.crawler.delayMs, 0);
  assert.equal(config.ranking.authorityWeight, 0);
});

test('ranking settings have safe defaults and can be changed', () => {
  const defaults = loadConfig();
  assert.equal(defaults.ranking.authorityWeight, 0.04);
  assert.ok(Array.isArray(defaults.ranking.qualityDomains));
  assert.ok(defaults.ranking.qualityDomains.includes('docs.python.org'));
  assert.ok(defaults.ranking.qualityDomains.every((domain) => domain.includes('.')));
  const custom = withEnv({ RANK_QUALITY_DOMAINS: ' Mine.example , other.example ' }, loadConfig);
  assert.deepEqual(custom.ranking.qualityDomains, ['mine.example', 'other.example']);
});

test('the default Gemini model is a stable one that is not being shut down', () => {
  const config = withEnv(
    { GEMINI_QUERY_MODEL: undefined, GEMINI_FALLBACK_MODELS: undefined },
    loadConfig
  );
  assert.equal(config.ai.model, 'gemini-3.5-flash');
  assert.ok(!config.ai.fallbackModels.includes('gemini-2.5-flash'));
  assert.deepEqual(config.ai.fallbackModels, ['gemini-3.6-flash', 'gemini-3.7-flash']);
});

test('a custom Gemini model still gets the stable model as the last fallback', () => {
  const config = withEnv(
    { GEMINI_QUERY_MODEL: 'my-model', GEMINI_FALLBACK_MODELS: 'a,b' },
    loadConfig
  );
  assert.deepEqual(config.ai.fallbackModels, ['a', 'b', 'gemini-3.5-flash']);
});
