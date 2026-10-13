import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function withEnv(values, run) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    process.env[key] = values[key];
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
  assert.ok(defaults.ranking.qualityDomains.includes('docs.python.org'));
  const custom = withEnv({ RANK_QUALITY_DOMAINS: ' Mine.example , other.example ' }, loadConfig);
  assert.deepEqual(custom.ranking.qualityDomains, ['mine.example', 'other.example']);
});

test('the stable Gemini model is the last fallback', () => {
  const config = withEnv({ GEMINI_FALLBACK_MODELS: '' }, loadConfig);
  assert.equal(config.ai.fallbackModels.at(-1), 'gemini-3.5-flash');
});
