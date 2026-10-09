import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, tokenSet } from '../src/core/tokenize.js';
import { analyzeQuery } from '../src/query/analyzer.js';

test('words at the end of a sentence lose the trailing dot', () => {
  const tokens = tokenize('We love asyncio. It is great.');
  assert.ok(tokens.includes('asyncio'));
  assert.ok(!tokens.includes('asyncio.'));
  assert.ok(tokens.includes('great'));
});

test('single letters and symbols like c, c++ and c# are kept', () => {
  const tokens = tokenize('C programming, C++ and C# and R');
  for (const word of ['c', 'c++', 'c#', 'r', 'programming']) assert.ok(tokens.includes(word), word);
});

test('words from other languages are kept', () => {
  assert.deepEqual(tokenize('پاکستان کا موسم'), ['پاکستان', 'کا', 'موسم']);
  assert.ok(tokenize('Café résumé').includes('café'));
});

test('compound words also give their parts', () => {
  const tokens = tokenize('node.js and fastapi-users and snake_case');
  for (const word of [
    'node.js',
    'node',
    'js',
    'fastapi-users',
    'fastapi',
    'users',
    'snake_case',
    'snake',
    'case'
  ]) {
    assert.ok(tokens.includes(word), word);
  }
});

test('number-only parts are not added as separate words', () => {
  const tokens = tokenize('python3.12');
  assert.ok(tokens.includes('python3.12'));
  assert.ok(tokens.includes('python3'));
  assert.ok(!tokens.includes('12'));
});

test('empty and missing input give no tokens', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.equal(tokenSet('a a b').size, 2);
});

test('query analyzer keeps short and non-English terms', () => {
  assert.deepEqual(analyzeQuery('C programming').terms, ['c', 'programming']);
  assert.deepEqual(analyzeQuery('C++ tutorial').terms, ['c++', 'tutorial']);
  assert.deepEqual(analyzeQuery('پاکستان کا موسم').terms, ['پاکستان', 'کا', 'موسم']);
});

test('query analyzer adds phrase words to terms and still reads site and phrase', () => {
  const q = analyzeQuery('"fast api" tutorial site:python.org');
  assert.deepEqual(q.phrases, ['fast api']);
  assert.equal(q.site, 'python.org');
  assert.ok(q.terms.includes('fast') && q.terms.includes('api') && q.terms.includes('tutorial'));
  assert.ok(!q.terms.some((term) => term.includes('site')));
});

test('query made only of stop words still has terms', () => {
  assert.deepEqual(analyzeQuery('the who').terms, ['the', 'who']);
  assert.deepEqual(analyzeQuery('how to use asyncio.').terms, ['use', 'asyncio']);
});
