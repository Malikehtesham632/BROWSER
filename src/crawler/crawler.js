import { extractDocument } from '../index/content.js';
import { RobotsChecker } from './robots.js';
import { HostLimiter } from './politeness.js';
import { CrawlFrontier } from './frontier.js';

const MS_PER_DAY = 86400000;

export class CrawlError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = 'CrawlError';
    this.retryable = retryable;
  }
}

function isTemporaryStatus(status) {
  return status >= 500 || status === 429 || status === 408;
}

export class OmniCrawler {
  constructor({
    store,
    frontier = new CrawlFrontier('data/crawl-frontier.json'),
    fetchImpl = fetch,
    timeoutMs = 8000,
    maxConcurrency = 4,
    userAgent = 'OmniBot/1.0',
    delayMs = 1000,
    robots,
    limiter,
    onEvent
  } = {}) {
    this.store = store;
    this.frontier = frontier;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxConcurrency = maxConcurrency;
    this.userAgent = userAgent;
    this.delayMs = delayMs;
    this.robots = robots ?? new RobotsChecker({ fetchImpl, timeoutMs, userAgent });
    this.limiter = limiter ?? new HostLimiter();
    this.onEvent = onEvent;
  }

  async seed(seeds) {
    await this.frontier.init();
    for (const url of seeds) await this.frontier.enqueue(url, { priority: 100, force: true });
    await this.frontier.flush();
  }

  #reportFailure(item, error) {
    this.frontier.fail(item.key, error, { retry: error.retryable !== false });
    this.onEvent?.({ type: 'error', url: item.url, error: String(error.message || error) });
  }

  async crawl(
    seeds = [],
    { maxPages = 25, maxDepth = 2, sameOrigin = true, recrawlDays = 7 } = {}
  ) {
    await this.frontier.init();
    if (seeds.length) await this.seed(seeds);
    let indexed = 0;
    let attempted = 0;
    let changed = 0;
    let failed = 0;
    while (attempted < maxPages) {
      const batch = await this.frontier.claim(Math.min(this.maxConcurrency, maxPages - attempted));
      if (!batch.length) break;
      attempted += batch.length;
      const results = await Promise.all(
        batch.map((item) => this.#visit(item).catch((error) => ({ error, item })))
      );
      for (const r of results) {
        if (r.error) {
          failed++;
          this.#reportFailure(r.item, r.error);
          continue;
        }
        let saved;
        try {
          saved = await this.store.upsert(r.doc);
        } catch (error) {
          failed++;
          this.#reportFailure(r.item, error);
          continue;
        }
        indexed++;
        if (saved.changed) changed++;
        const next = new Date(Date.now() + recrawlDays * MS_PER_DAY).toISOString();
        this.frontier.complete(r.item.key, { nextCrawlAt: next, hash: r.doc.hash });
        this.onEvent?.({
          type: saved.changed ? 'indexed' : 'unchanged',
          url: r.doc.url,
          title: r.doc.title,
          depth: r.item.depth,
          version: saved.doc.version
        });
        if (r.item.depth < maxDepth) {
          const origin = new URL(r.doc.url).origin;
          for (const link of r.doc.links) {
            try {
              if (sameOrigin && new URL(link).origin !== origin) continue;
            } catch {
              continue;
            }
            await this.frontier.enqueue(link, {
              depth: r.item.depth + 1,
              priority: Math.max(1, 100 - r.item.depth * 10),
              discoveredBy: r.doc.canonical
            });
          }
        }
      }
    }
    await this.frontier.flush();
    await this.store.flush();
    return {
      processed: indexed,
      attempted,
      changed,
      failed,
      frontier: this.frontier.stats(),
      index: this.store.stats()
    };
  }

  async #visit(item) {
    const permission = await this.robots.check(item.url);
    if (!permission.allowed) {
      throw new CrawlError(
        permission.unavailable ? 'robots.txt is unavailable' : 'Blocked by robots.txt',
        { retryable: permission.unavailable }
      );
    }
    const host = new URL(item.url).host;
    await this.limiter.wait(host, Math.max(this.delayMs, permission.crawlDelayMs));
    const res = await this.fetchImpl(item.url, {
      redirect: 'follow',
      headers: { 'user-agent': this.userAgent, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) {
      throw new CrawlError(`HTTP ${res.status}`, { retryable: isTemporaryStatus(res.status) });
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new CrawlError('Not HTML', { retryable: false });
    }
    const html = await res.text();
    return { item, doc: extractDocument(html, res.url || item.url) };
  }
}
