const DEFAULT_TTL_MS = 60 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 5 * 60 * 1000;
const MAX_CRAWL_DELAY_MS = 30 * 1000;
const MAX_ROBOTS_CHARS = 512 * 1024;

function patternToRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + (anchored ? '$' : ''));
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastLineWasAgent = false;
  const lines = String(text || '')
    .slice(0, MAX_ROBOTS_CHARS)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      lastLineWasAgent = false;
      if (!value) continue;
      current.rules.push({
        allow: field === 'allow',
        pattern: value,
        regex: patternToRegex(value)
      });
    } else if (field === 'crawl-delay') {
      lastLineWasAgent = false;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }
  return groups;
}

export function selectRules(groups, userAgent) {
  const fullName = String(userAgent || '').toLowerCase();
  const productName = fullName.split('/')[0].trim();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && (agent === productName || agent === fullName))
  );
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const delays = chosen.map((group) => group.crawlDelay).filter((delay) => delay !== null);
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelayMs: delays.length ? Math.min(delays[0] * 1000, MAX_CRAWL_DELAY_MS) : 0
  };
}

export function isAllowed(rules, target) {
  let best = null;
  for (const rule of rules) {
    if (!rule.regex.test(target)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

const ALLOW_ALL = { rules: [], crawlDelayMs: 0, unavailable: false };
const BLOCK_ALL = {
  rules: [{ allow: false, pattern: '/', regex: /^\// }],
  crawlDelayMs: 0,
  unavailable: true
};

export class RobotsChecker {
  constructor({
    fetchImpl = fetch,
    timeoutMs = 4000,
    userAgent = 'OmniBot/1.0',
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.ttlMs = ttlMs;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
  }

  async #download(origin) {
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'user-agent': this.userAgent },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (res.status >= 500) return BLOCK_ALL;
      if (!res.ok) return ALLOW_ALL;
      const groups = parseRobots(await res.text());
      return { ...selectRules(groups, this.userAgent), unavailable: false };
    } catch {
      return BLOCK_ALL;
    }
  }

  async #rulesFor(origin) {
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    let request = this.pending.get(origin);
    if (!request) {
      request = this.#download(origin)
        .then((value) => {
          const ttl = value.unavailable ? Math.min(UNAVAILABLE_TTL_MS, this.ttlMs) : this.ttlMs;
          this.cache.set(origin, { value, expiresAt: this.now() + ttl });
          return value;
        })
        .finally(() => this.pending.delete(origin));
      this.pending.set(origin, request);
    }
    return request;
  }

  async check(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, crawlDelayMs: 0, unavailable: false };
    }
    const entry = await this.#rulesFor(parsed.origin);
    const allowed = isAllowed(entry.rules, parsed.pathname + parsed.search);
    return { allowed, crawlDelayMs: entry.crawlDelayMs, unavailable: entry.unavailable };
  }
}

export async function canCrawl(url, options = {}) {
  const checker = new RobotsChecker(options);
  return (await checker.check(url)).allowed;
}
