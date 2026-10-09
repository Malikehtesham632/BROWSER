import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CrawlFrontier } from '../src/crawler/frontier.js';

async function newFrontier() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-frontier-'));
  const file = path.join(dir, 'frontier.json');
  const frontier = new CrawlFrontier(file);
  await frontier.init();
  return { frontier, file };
}

const HOUR = 3600 * 1000;

test('a failed page waits for its retry time', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  frontier.fail(item.key, new Error('boom'));
  assert.equal(frontier.get(item.key).status, 'retry');
  assert.equal((await frontier.claim(5)).length, 0);
  const later = await frontier.claim(5, Date.now() + HOUR);
  assert.equal(later.length, 1);
  assert.equal(later[0].key, item.key);
});

test('retry waits grow with each attempt', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const waits = [];
  for (let i = 0; i < 2; i++) {
    const [item] = await frontier.claim(1, Date.now() + 10 * HOUR);
    frontier.fail(item.key, 'boom');
    waits.push(Date.parse(frontier.get(item.key).nextCrawlAt) - Date.now());
  }
  assert.ok(waits[1] > waits[0]);
});

test('a page fails for good after three attempts', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  for (let i = 0; i < 3; i++) {
    const [item] = await frontier.claim(1, Date.now() + 10 * HOUR);
    frontier.fail(item.key, 'boom');
  }
  assert.equal(frontier.get('https://example.com/a').status, 'failed');
  assert.equal((await frontier.claim(5, Date.now() + 100 * HOUR)).length, 0);
});

test('a page that should not be retried fails at once', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  frontier.fail(item.key, 'Not HTML', { retry: false });
  assert.equal(frontier.get(item.key).status, 'failed');
});

test('a successful crawl resets the attempt counter', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  for (let i = 0; i < 4; i++) {
    const [item] = await frontier.claim(1, Date.now() + (i + 1) * 10 * HOUR);
    frontier.complete(item.key, { nextCrawlAt: new Date(Date.now() + 5 * HOUR).toISOString() });
  }
  const [item] = await frontier.claim(1, Date.now() + 100 * HOUR);
  frontier.fail(item.key, 'boom');
  assert.equal(frontier.get(item.key).status, 'retry');
});

test('a finished page is not queued again when another page links to it', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  const next = new Date(Date.now() + 7 * 24 * HOUR).toISOString();
  frontier.complete(item.key, { nextCrawlAt: next });
  await frontier.enqueue('https://example.com/a', { depth: 1 });
  assert.equal(frontier.get(item.key).status, 'done');
  assert.equal(frontier.get(item.key).nextCrawlAt, next);
  assert.equal((await frontier.claim(5)).length, 0);
});

test('a finished page is claimed again when its recrawl date arrives', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  frontier.complete(item.key, { nextCrawlAt: new Date(Date.now() + HOUR).toISOString() });
  assert.equal((await frontier.claim(5)).length, 0);
  assert.equal((await frontier.claim(5, Date.now() + 2 * HOUR)).length, 1);
});

test('force puts a finished or failed page back in the queue', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  frontier.complete(item.key, { nextCrawlAt: new Date(Date.now() + 100 * HOUR).toISOString() });
  await frontier.enqueue('https://example.com/a', { force: true });
  assert.equal(frontier.get(item.key).status, 'queued');
  assert.equal((await frontier.claim(5)).length, 1);
  frontier.fail(item.key, 'x', { retry: false });
  await frontier.enqueue('https://example.com/a', { force: true });
  assert.equal(frontier.get(item.key).status, 'queued');
  assert.equal(frontier.get(item.key).attempts, 0);
});

test('a page stuck in crawling is released after ten minutes', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  const [item] = await frontier.claim(1);
  assert.equal(frontier.get(item.key).status, 'crawling');
  assert.equal((await frontier.claim(5, Date.now() + 60 * 1000)).length, 0);
  const again = await frontier.claim(5, Date.now() + 11 * 60 * 1000);
  assert.equal(again.length, 1);
});

test('pages left in crawling are put back in the queue after a restart', async () => {
  const { frontier, file } = await newFrontier();
  await frontier.enqueue('https://example.com/a');
  await frontier.claim(1);
  await frontier.flush();
  const restarted = new CrawlFrontier(file);
  await restarted.init();
  assert.equal(restarted.get('https://example.com/a').status, 'retry');
  assert.equal((await restarted.claim(5)).length, 1);
});

test('get works with both a url and a key', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://www.example.com/a?utm_source=x');
  const byUrl = frontier.get('https://example.com/a');
  assert.ok(byUrl);
  assert.equal(frontier.get(byUrl.key), byUrl);
  assert.equal(frontier.get('not a url'), undefined);
});

test('higher priority pages are claimed first', async () => {
  const { frontier } = await newFrontier();
  await frontier.enqueue('https://example.com/low', { priority: 1 });
  await frontier.enqueue('https://example.com/high', { priority: 90 });
  const [first] = await frontier.claim(1);
  assert.equal(first.url, 'https://example.com/high');
});
