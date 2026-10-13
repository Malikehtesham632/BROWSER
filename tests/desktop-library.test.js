import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import library from '../desktop/library.cjs';

const { Library } = library;
const DAY = 86400000;

async function makeLibrary(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-library-'));
  const file = path.join(dir, 'library.json');
  const clock = { time: Date.UTC(2026, 9, 1, 12, 0, 0) };
  const lib = new Library(file, { now: () => clock.time, saveDelayMs: 5, ...options });
  await lib.init();
  return { lib, file, clock };
}

test('bookmarks can be added, found, toggled and removed', async () => {
  const { lib } = await makeLibrary();
  const bookmark = lib.addBookmark('https://example.com/docs#intro', '  Example   docs ');
  assert.equal(bookmark.url, 'https://example.com/docs');
  assert.equal(bookmark.title, 'Example docs');
  assert.equal(lib.isBookmarked('https://example.com/docs#other'), true);
  assert.equal(lib.addBookmark('https://example.com/docs', 'again').id, bookmark.id);
  assert.equal(lib.bookmarks().length, 1);
  assert.deepEqual(lib.toggleBookmark('https://example.com/docs'), { bookmarked: false });
  assert.equal(lib.isBookmarked('https://example.com/docs'), false);
  assert.equal(lib.toggleBookmark('https://example.com/new', 'New').bookmarked, true);
  assert.equal(lib.removeBookmark(lib.bookmarks()[0].id), true);
  assert.equal(lib.removeBookmark('b999'), false);
});

test('only normal web addresses are stored', async () => {
  const { lib } = await makeLibrary();
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'https://user:pw@example.com', '']) {
    assert.equal(lib.addBookmark(bad, 'x'), null, bad);
    assert.equal(lib.recordVisit(bad, 'x'), null, bad);
  }
  assert.equal(lib.bookmarks().length, 0);
  assert.equal(lib.history().length, 0);
});

test('visits are counted and ordered by the most recent', async () => {
  const { lib, clock } = await makeLibrary();
  lib.recordVisit('https://a.example/', 'A');
  clock.time += 1000;
  lib.recordVisit('https://b.example/', 'B');
  clock.time += 1000;
  lib.recordVisit('https://a.example/', '');
  const entries = lib.history();
  assert.deepEqual(entries.map((e) => e.url), ['https://a.example/', 'https://b.example/']);
  assert.equal(entries[0].visitCount, 2);
  assert.equal(entries[0].title, 'A');
  lib.updateTitle('https://a.example/', 'A renamed');
  assert.equal(lib.history()[0].title, 'A renamed');
});

test('history can be searched, trimmed to a limit, removed and cleared', async () => {
  const { lib } = await makeLibrary();
  lib.recordVisit('https://python.org/', 'Python home');
  lib.recordVisit('https://mozilla.org/', 'Mozilla');
  assert.equal(lib.history({ query: 'python' }).length, 1);
  assert.equal(lib.history({ query: 'python mozilla' }).length, 0);
  assert.equal(lib.history({ limit: 1 }).length, 1);
  assert.equal(lib.removeHistory('https://python.org/'), true);
  assert.equal(lib.removeHistory('https://python.org/'), false);
  lib.addSearch('learn rust');
  assert.equal(lib.clearHistory(), 1);
  assert.equal(lib.history().length, 0);
  assert.deepEqual(lib.searches(), []);
});

test('history never grows past its limit and keeps the newest pages', async () => {
  const { lib, clock } = await makeLibrary();
  for (let i = 0; i < 5003; i++) {
    clock.time += 1;
    lib.recordVisit(`https://site${i}.example/`, `Site ${i}`);
  }
  assert.equal(lib.data.history.length, 5000);
  assert.equal(lib.isBookmarked('https://site0.example/'), false);
  assert.ok(lib.historyIndex.has('https://site5002.example/'));
  assert.ok(!lib.historyIndex.has('https://site0.example/'));
});

test('top sites favour pages that are visited often and recently', async () => {
  const { lib, clock } = await makeLibrary();
  for (let i = 0; i < 6; i++) lib.recordVisit('https://often.example/page' + (i % 2), 'Often');
  lib.recordVisit('https://once.example/', 'Once');
  clock.time += 60 * DAY;
  lib.recordVisit('https://fresh.example/', 'Fresh');
  lib.addBookmark('https://saved.example/read', 'Saved');
  const sites = lib.topSites(10);
  assert.deepEqual(
    sites.map((site) => site.title),
    ['saved.example', 'fresh.example', 'often.example', 'once.example']
  );
  assert.ok(sites.every((s) => s.url.endsWith('/')));
  assert.equal(lib.topSites(1).length, 1);
});

test('suggestions match words in the title or address and rank bookmarks first', async () => {
  const { lib } = await makeLibrary();
  lib.recordVisit('https://docs.python.org/3/library/asyncio.html', 'asyncio — Python docs');
  lib.recordVisit('https://news.example/python-tips', 'Tips');
  lib.addBookmark('https://python.org/', 'Python home');
  lib.addSearch('python asyncio tutorial');
  const rows = lib.suggest('python');
  assert.equal(rows[0].type, 'bookmark');
  assert.equal(rows[0].url, 'https://python.org/');
  assert.ok(rows.some((r) => r.type === 'search' && r.query === 'python asyncio tutorial'));
  assert.ok(rows.every((r) => !('score' in r)));
  assert.deepEqual(lib.suggest('   '), []);
  assert.deepEqual(lib.suggest('zzzzz'), []);
  assert.equal(lib.suggest('python', 2).length, 2);
  assert.equal(lib.suggest('python asyncio').length > 0, true);
});

test('page icons are saved per site and only for https images', async () => {
  const { lib } = await makeLibrary();
  assert.equal(lib.setIcon('https://example.com/a', 'https://example.com/favicon.ico'), true);
  assert.equal(lib.setIcon('https://example.com/b', 'https://example.com/favicon.ico'), false);
  assert.equal(lib.setIcon('https://example.com/a', 'http://example.com/favicon.ico'), false);
  assert.equal(lib.setIcon('https://example.com/a', 'javascript:alert(1)'), false);
  lib.addBookmark('https://example.com/page', 'Page');
  assert.equal(lib.bookmarks()[0].icon, 'https://example.com/favicon.ico');
});

test('everything is saved to disk and loaded again', async () => {
  const { lib, file } = await makeLibrary();
  lib.addBookmark('https://example.com/', 'Example');
  lib.recordVisit('https://example.com/', 'Example');
  lib.addSearch('hello world');
  lib.setIcon('https://example.com/', 'https://example.com/icon.png');
  await lib.flush();
  const again = new Library(file);
  await again.init();
  assert.equal(again.bookmarks()[0].title, 'Example');
  assert.equal(again.history()[0].visitCount, 1);
  assert.deepEqual(again.searches(), ['hello world']);
  assert.equal(again.iconFor('https://example.com/x'), 'https://example.com/icon.png');
});

test('a damaged library file is set aside and the browser still starts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-library-bad-'));
  const file = path.join(dir, 'library.json');
  await fs.writeFile(file, '{ this is not json');
  const lib = new Library(file);
  await lib.init();
  assert.equal(lib.bookmarks().length, 0);
  await fs.access(`${file}.corrupt`);
  lib.addBookmark('https://example.com/', 'Example');
  await lib.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).bookmarks.length, 1);
});

test('unexpected data in the file is cleaned while loading', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-library-odd-'));
  const file = path.join(dir, 'library.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      bookmarks: [{ url: 'javascript:1' }, { url: 'https://ok.example/', title: 'Ok' }, null, { url: 'https://ok.example/#x' }],
      history: [{ url: 'file:///x' }, { url: 'https://ok.example/', visitCount: -5 }],
      searches: [{ query: '' }, { query: 'fine' }],
      icons: { 'https://ok.example': 'http://ok.example/i.png', 'not an origin': 'https://x.example/i.png' }
    })
  );
  const lib = new Library(file);
  await lib.init();
  assert.equal(lib.bookmarks().length, 1);
  assert.equal(lib.history().length, 1);
  assert.equal(lib.history()[0].visitCount, 1);
  assert.deepEqual(lib.searches(), ['fine']);
  assert.deepEqual(lib.data.icons, {});
});

test('repeated searches are merged and the newest comes first', async () => {
  const { lib, clock } = await makeLibrary();
  lib.addSearch('first');
  clock.time += 10;
  lib.addSearch('Second');
  clock.time += 10;
  lib.addSearch('FIRST');
  assert.deepEqual(lib.searches(), ['FIRST', 'Second']);
  lib.addSearch('   ');
  assert.equal(lib.searches().length, 2);
});
