import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRobots,
  selectRules,
  isAllowed,
  RobotsChecker,
  canCrawl
} from '../src/crawler/robots.js';

const UA = 'OmniBot/1.0';

function allowed(text, target, userAgent = UA) {
  return isAllowed(selectRules(parseRobots(text), userAgent).rules, target);
}

function response(status, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test('a later Allow: / does not cancel an earlier Disallow', () => {
  const text = 'User-agent: *\nDisallow: /private\nAllow: /\n';
  assert.equal(allowed(text, '/private/x'), false);
  assert.equal(allowed(text, '/open'), true);
});

test('the most specific rule wins in any order', () => {
  const first = 'User-agent: *\nAllow: /private/public\nDisallow: /private\n';
  const second = 'User-agent: *\nDisallow: /private\nAllow: /private/public\n';
  for (const text of [first, second]) {
    assert.equal(allowed(text, '/private/public/page'), true);
    assert.equal(allowed(text, '/private/secret'), false);
  }
});

test('Allow wins when Allow and Disallow are equally specific', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /a\nAllow: /a\n', '/a/b'), true);
});

test('wildcards and end anchors work', () => {
  const text = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\n';
  assert.equal(allowed(text, '/docs/file.pdf'), false);
  assert.equal(allowed(text, '/docs/file.pdfx'), true);
  assert.equal(allowed(text, '/tmp123/cache'), false);
  assert.equal(allowed(text, '/other'), true);
});

test('an empty Disallow allows everything', () => {
  assert.equal(allowed('User-agent: *\nDisallow:\n', '/anything'), true);
});

test('rules with a colon in the value are read fully', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /a:b\n', '/a:b/c'), false);
  assert.equal(allowed('User-agent: *\nDisallow: /a:b\n', '/a'), true);
});

test('rules can match the query string', () => {
  const text = 'User-agent: *\nDisallow: /search?q=\n';
  assert.equal(allowed(text, '/search?q=cats'), false);
  assert.equal(allowed(text, '/search'), true);
});

test('comments, blank lines and a byte order mark are ignored', () => {
  const text = '\uFEFF# hello\n\nUser-agent: * # everyone\nDisallow: /x # no\n';
  assert.equal(allowed(text, '/x/y'), false);
});

test('a group for our bot replaces the star group', () => {
  const text = 'User-agent: *\nDisallow: /\n\nUser-agent: OmniBot\nDisallow: /private\n';
  assert.equal(allowed(text, '/public'), true);
  assert.equal(allowed(text, '/private'), false);
  assert.equal(allowed(text, '/public', 'OtherBot/2.0'), false);
});

test('several user-agent lines share one group', () => {
  const text = 'User-agent: AlphaBot\nUser-agent: OmniBot\nDisallow: /shared\n';
  assert.equal(allowed(text, '/shared/page'), false);
});

test('a missing group means everything is allowed', () => {
  assert.equal(allowed('User-agent: OtherBot\nDisallow: /\n', '/page'), true);
});

test('crawl delay is read in seconds and capped', () => {
  assert.equal(selectRules(parseRobots('User-agent: *\nCrawl-delay: 2\n'), UA).crawlDelayMs, 2000);
  assert.equal(
    selectRules(parseRobots('User-agent: *\nCrawl-delay: 9999\n'), UA).crawlDelayMs,
    30000
  );
  assert.equal(selectRules(parseRobots('User-agent: *\nCrawl-delay: abc\n'), UA).crawlDelayMs, 0);
});

test('a missing robots.txt (404) allows everything', async () => {
  const checker = new RobotsChecker({ fetchImpl: async () => response(404) });
  const result = await checker.check('https://site.test/page');
  assert.equal(result.allowed, true);
  assert.equal(result.unavailable, false);
});

test('a server error or network error blocks the site for now', async () => {
  const broken = new RobotsChecker({ fetchImpl: async () => response(503) });
  const down = new RobotsChecker({
    fetchImpl: async () => {
      throw new Error('offline');
    }
  });
  for (const checker of [broken, down]) {
    const result = await checker.check('https://site.test/page');
    assert.equal(result.allowed, false);
    assert.equal(result.unavailable, true);
  }
});

test('robots.txt is fetched once per site and shared by parallel checks', async () => {
  let calls = 0;
  const checker = new RobotsChecker({
    fetchImpl: async () => {
      calls++;
      return response(200, 'User-agent: *\nDisallow: /no\n');
    }
  });
  const results = await Promise.all([
    checker.check('https://site.test/a'),
    checker.check('https://site.test/no/b'),
    checker.check('https://site.test/c')
  ]);
  await checker.check('https://site.test/d');
  assert.deepEqual(
    results.map((r) => r.allowed),
    [true, false, true]
  );
  assert.equal(calls, 1);
});

test('cached robots.txt expires', async () => {
  let calls = 0;
  let clock = 1000;
  const checker = new RobotsChecker({
    ttlMs: 5000,
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return response(200, 'User-agent: *\n');
    }
  });
  await checker.check('https://site.test/a');
  clock += 4000;
  await checker.check('https://site.test/a');
  assert.equal(calls, 1);
  clock += 2000;
  await checker.check('https://site.test/a');
  assert.equal(calls, 2);
});

test('different sites have separate robots.txt rules', async () => {
  const checker = new RobotsChecker({
    fetchImpl: async (url) =>
      response(200, String(url).includes('one.test') ? 'User-agent: *\nDisallow: /\n' : '')
  });
  assert.equal((await checker.check('https://one.test/a')).allowed, false);
  assert.equal((await checker.check('https://two.test/a')).allowed, true);
});

test('invalid urls are not allowed', async () => {
  const checker = new RobotsChecker({ fetchImpl: async () => response(404) });
  assert.equal((await checker.check('not a url')).allowed, false);
});

test('canCrawl still works as a simple helper', async () => {
  const fetchImpl = async () => response(200, 'User-agent: *\nDisallow: /x\n');
  assert.equal(await canCrawl('https://site.test/x/1', { fetchImpl }), false);
  assert.equal(await canCrawl('https://site.test/y', { fetchImpl }), true);
});

test('an empty Disallow does not merge the next group into it', () => {
  const allowAllBlockBadBot = 'User-agent: *\nDisallow:\n\nUser-agent: BadBot\nDisallow: /\n';
  assert.equal(allowed(allowAllBlockBadBot, '/page'), true);
  assert.equal(allowed(allowAllBlockBadBot, '/page', 'BadBot/1.0'), false);
  const ownBotAllowed = 'User-agent: OmniBot\nDisallow:\n\nUser-agent: *\nDisallow: /\n';
  assert.equal(allowed(ownBotAllowed, '/page'), true);
  assert.equal(allowed(ownBotAllowed, '/page', 'OtherBot/1.0'), false);
});
