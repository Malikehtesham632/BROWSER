import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankResults, DEFAULT_AUTHORITY_WEIGHT } from '../src/ranking/engine.js';

const query = { terms: ['guide'], phrases: [] };

function twoResults() {
  return [
    { url: 'https://random.example/guide', title: 'Guide', snippet: 'A guide', score: 1 },
    { url: 'https://docs.python.org/guide', title: 'Guide', snippet: 'A guide', score: 1 }
  ];
}

test('a short term does not match inside a longer word', () => {
  const out = rerankResults(
    [{ url: 'https://a.example/x', title: 'Rapid therapy', snippet: 'rapid recovery', score: 1 }],
    { terms: ['api'], phrases: [] }
  );
  assert.equal(out[0].ranking.titleCoverage, 0);
  assert.equal(out[0].ranking.termCoverage, 0);
});

test('a whole word still matches', () => {
  const out = rerankResults(
    [{ url: 'https://a.example/x', title: 'The API guide', snippet: 'Learn the API', score: 1 }],
    { terms: ['api'], phrases: [] }
  );
  assert.equal(out[0].ranking.titleCoverage, 1);
  assert.equal(out[0].ranking.termCoverage, 1);
});

test('words ending a sentence and symbols match the query', () => {
  const out = rerankResults(
    [{ url: 'https://a.example/x', title: 'Learn C++', snippet: 'We use asyncio.', score: 1 }],
    { terms: ['c++', 'asyncio'], phrases: [] }
  );
  assert.equal(out[0].ranking.termCoverage, 1);
});

test('a phrase is found even when the query has no other terms', () => {
  const out = rerankResults(
    [{ url: 'https://a.example/x', title: 'A', snippet: 'about fast api tools', score: 1 }],
    { terms: [], phrases: ['fast api'] }
  );
  assert.equal(out[0].ranking.phraseMatch, 1);
});

test('the default authority boost is small', () => {
  assert.ok(DEFAULT_AUTHORITY_WEIGHT > 0 && DEFAULT_AUTHORITY_WEIGHT <= 0.05);
  const [first, second] = rerankResults(twoResults(), query);
  assert.equal(first.url, 'https://docs.python.org/guide');
  assert.ok(first.score - second.score < 0.05);
});

test('authority weight 0 turns the domain boost off', () => {
  const out = rerankResults(twoResults(), query, { authorityWeight: 0 });
  assert.equal(out[0].score, out[1].score);
});

test('a better text match beats a trusted domain', () => {
  const out = rerankResults(
    [
      { url: 'https://docs.python.org/other', title: 'Unrelated', snippet: 'nothing', score: 1 },
      { url: 'https://random.example/guide', title: 'Guide', snippet: 'A guide', score: 1 }
    ],
    query
  );
  assert.equal(out[0].url, 'https://random.example/guide');
});

test('the trusted domain list can be changed', () => {
  const results = [
    { url: 'https://mine.example/guide', title: 'Guide', snippet: 'A guide', score: 1 },
    { url: 'https://random.example/guide', title: 'Guide', snippet: 'A guide', score: 1 }
  ];
  const out = rerankResults(results, query, { qualityDomains: ['mine.example'] });
  assert.equal(out[0].url, 'https://mine.example/guide');
  assert.equal(out[0].ranking.authority, 1);
});

test('a bad authority weight falls back to the default', () => {
  const out = rerankResults(twoResults(), query, { authorityWeight: -5 });
  assert.ok(out[0].score > out[1].score);
});
