import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../src/index/store.js';
import { rankIndexed } from '../src/index/rank.js';
import { analyzeQuery } from '../src/query/analyzer.js';

async function newStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-index-'));
  const file = path.join(dir, 'index.json');
  const store = new DocumentStore(file);
  await store.init();
  return { store, file };
}

function page(url, title, content, extra = {}) {
  return {
    url,
    title,
    description: '',
    headings: [],
    content,
    wordCount: content.split(/\s+/).length,
    hash: `${url}-${content}`,
    indexedAt: new Date().toISOString(),
    ...extra
  };
}

const longText = (word) => `${word} ${'filler '.repeat(120)}`;

test('a word at the end of a sentence can be found', async () => {
  const { store } = await newStore();
  await store.upsert(page('https://a.example/1', 'Guide', longText('We love asyncio.')));
  const found = rankIndexed(store, analyzeQuery('asyncio'));
  assert.equal(found.length, 1);
  assert.equal(found[0].url, 'https://a.example/1');
});

test('single letter language names are searchable', async () => {
  const { store } = await newStore();
  await store.upsert(page('https://a.example/c', 'C programming', longText('Learn C programming')));
  await store.upsert(page('https://a.example/cook', 'Cooking', longText('Pasta and sauce')));
  const found = rankIndexed(store, analyzeQuery('C programming'));
  assert.equal(found[0].url, 'https://a.example/c');
});

test('undefined headings do not create a fake word', async () => {
  const { store } = await newStore();
  const doc = page('https://a.example/h', 'Title', longText('hello'));
  delete doc.headings;
  await store.upsert(doc);
  assert.equal(store.documentFrequency('undefined'), 0);
});

test('rare words count more than common words using the whole index', async () => {
  const { store } = await newStore();
  for (let i = 0; i < 30; i++) {
    await store.upsert(page(`https://a.example/common-${i}`, `Common ${i}`, longText('common')));
  }
  await store.upsert(page('https://a.example/rare', 'Other', longText('common rare')));
  assert.equal(store.documentFrequency('common'), 31);
  assert.equal(store.documentFrequency('rare'), 1);
  const found = rankIndexed(store, analyzeQuery('common rare'));
  assert.equal(found[0].url, 'https://a.example/rare');
});

test('updating a page removes its old words and keeps lengths correct', async () => {
  const { store } = await newStore();
  await store.upsert(page('https://a.example/p', 'Page', 'alpha beta gamma'));
  assert.equal(store.documentFrequency('alpha'), 1);
  await store.upsert(page('https://a.example/p', 'Page', 'delta epsilon'));
  assert.equal(store.documentFrequency('alpha'), 0);
  assert.equal(store.documentFrequency('delta'), 1);
  assert.equal(store.documentCount(), 1);
  const doc = store.get('https://a.example/p');
  assert.equal(store.averageLength(), store.lengthOf(doc));
  assert.equal(store.lengthOf(doc), 3);
});

test('index can be saved and loaded again with the same results', async () => {
  const { store, file } = await newStore();
  await store.upsert(
    page('https://a.example/1', 'FastAPI guide', longText('FastAPI authentication'))
  );
  await store.upsert(page('https://a.example/2', 'Cooking', longText('Pasta')));
  await store.flush();
  const again = new DocumentStore(file);
  await again.init();
  assert.equal(again.documentCount(), 2);
  assert.equal(again.averageLength(), store.averageLength());
  const found = rankIndexed(again, analyzeQuery('FastAPI authentication'));
  assert.equal(found[0].url, 'https://a.example/1');
});

test('phrase only query finds pages and prefers the exact phrase', async () => {
  const { store } = await newStore();
  await store.upsert(
    page('https://a.example/exact', 'Guide', longText('this is a fast api tutorial'))
  );
  await store.upsert(
    page('https://a.example/apart', 'Guide', longText('an api that is very fast'))
  );
  const q = analyzeQuery('"fast api"');
  assert.deepEqual(q.terms, ['fast', 'api']);
  const found = rankIndexed(store, q);
  assert.equal(found[0].url, 'https://a.example/exact');
  assert.equal(found.length, 2);
});

test('missing indexedAt does not change the score', async () => {
  const { store } = await newStore();
  const doc = page('https://a.example/x', 'Title', longText('zebra'));
  delete doc.indexedAt;
  await store.upsert(doc);
  const stored = store.get('https://a.example/x');
  delete stored.indexedAt;
  const fresh = page('https://a.example/y', 'Title', longText('zebra'));
  await store.upsert(fresh);
  const found = rankIndexed(store, analyzeQuery('zebra'));
  assert.ok(Math.abs(found[0].score - found[1].score) < 0.05);
});
