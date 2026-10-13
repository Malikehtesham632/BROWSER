import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalUrlKey, isPublicHttpUrl } from '../core/url.js';

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 5000;

function timeOf(value) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function isDue(item, now) {
  return !item.nextCrawlAt || timeOf(item.nextCrawlAt) <= now;
}

export class CrawlFrontier {
  constructor(file) {
    this.file = file;
    this.items = new Map();
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      for (const item of JSON.parse(raw)) {
        this.items.set(item.key, item);
        if (item.status === 'crawling') this.#releaseStuck(item);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    this.ready = true;
  }

  #releaseStuck(item) {
    item.lastError = 'Interrupted while crawling';
    item.nextCrawlAt = null;
    item.status = (item.attempts || 0) >= MAX_ATTEMPTS ? 'failed' : 'retry';
  }

  async enqueue(
    url,
    {
      depth = 0,
      priority = 0,
      discoveredBy = null,
      nextCrawlAt = null,
      force = false,
      requeueDone = false
    } = {}
  ) {
    await this.init();
    if (!isPublicHttpUrl(url)) return false;
    const key = canonicalUrlKey(url);
    if (!key) return false;
    let item = this.items.get(key);
    if (!item) {
      item = {
        key,
        url,
        depth,
        priority,
        status: 'queued',
        attempts: 0,
        createdAt: new Date().toISOString()
      };
      this.items.set(key, item);
    }
    if (depth < item.depth) item.depth = depth;
    item.priority = Math.max(item.priority || 0, priority);
    if (discoveredBy) item.discoveredBy = discoveredBy;
    if (nextCrawlAt !== null) item.nextCrawlAt = nextCrawlAt;
    if ((force || requeueDone) && (item.status === 'done' || item.status === 'failed')) {
      item.url = url;
      item.status = 'queued';
      item.attempts = 0;
      item.nextCrawlAt = null;
    }
    return true;
  }

  async claim(limit = 10, now = Date.now()) {
    await this.init();
    for (const item of this.items.values()) {
      if (item.status === 'crawling' && now - timeOf(item.lastAttemptAt) >= STUCK_AFTER_MS) {
        this.#releaseStuck(item);
      }
    }
    const eligible = [...this.items.values()]
      .filter((item) => {
        if (item.status === 'queued' || item.status === 'retry') return isDue(item, now);
        if (item.status === 'done') return Boolean(item.nextCrawlAt) && isDue(item, now);
        return false;
      })
      .sort((a, b) => b.priority - a.priority || timeOf(a.nextCrawlAt) - timeOf(b.nextCrawlAt))
      .slice(0, limit);
    for (const item of eligible) {
      item.status = 'crawling';
      item.lastAttemptAt = new Date(now).toISOString();
      item.attempts = (item.attempts || 0) + 1;
    }
    return eligible;
  }

  complete(key, { nextCrawlAt = null, hash = null } = {}) {
    const item = this.items.get(key);
    if (!item) return;
    item.status = 'done';
    item.attempts = 0;
    item.lastCrawledAt = new Date().toISOString();
    item.nextCrawlAt = nextCrawlAt;
    delete item.lastError;
    if (hash) item.lastHash = hash;
  }

  fail(key, error, { retry = true, maxAttempts = MAX_ATTEMPTS } = {}) {
    const item = this.items.get(key);
    if (!item) return;
    item.lastError = String(error || 'Unknown error').slice(0, 300);
    item.status = retry && (item.attempts || 0) < maxAttempts ? 'retry' : 'failed';
    if (item.status === 'retry') {
      const steps = Math.max(0, (item.attempts || 1) - 1);
      const delay = Math.min(MAX_RETRY_DELAY_MS, 2 ** steps * BASE_RETRY_DELAY_MS);
      item.nextCrawlAt = new Date(Date.now() + delay).toISOString();
    }
  }

  get(input) {
    return this.items.get(input) ?? this.items.get(canonicalUrlKey(input));
  }

  stats() {
    const counts = {};
    for (const item of this.items.values()) counts[item.status] = (counts[item.status] || 0) + 1;
    return { urls: this.items.size, ...counts };
  }

  async flush() {
    await this.init();
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify([...this.items.values()], null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}
