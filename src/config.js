import path from 'node:path';

const DEFAULT_SEARXNG_INSTANCES = [
  'https://searx.tiekoetter.com/',
  'https://search.sapti.me/',
  'https://searx.work/'
];

const STABLE_GEMINI_MODEL = 'gemini-3.5-flash';

function num(name, fallback, min = -Infinity, max = Infinity) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function domains(raw, fallback = '') {
  return (raw || fallback)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function searxngInstances() {
  const raw = process.env.SEARXNG_INSTANCES;
  const instances = raw === undefined ? DEFAULT_SEARXNG_INSTANCES : raw.split(',').map((s) => s.trim()).filter(Boolean);
  const normalized = [];
  for (const value of instances) {
    if (typeof value !== 'string')
      throw new Error('Every SEARXNG_INSTANCES entry must be a URL string');
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid SearXNG instance URL: ${value}`);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(`SearXNG instance must be a credential-free HTTP(S) base URL: ${value}`);
    const base = url.href.replace(/\/+$/, '');
    if (!normalized.includes(base)) normalized.push(base);
  }
  return normalized;
}

export function loadConfig() {
  const queryModel = process.env.GEMINI_QUERY_MODEL || 'gemini-3.5-flash';
  const fallbackModels = domains(
    process.env.GEMINI_FALLBACK_MODELS,
    'gemini-3.6-flash,gemini-3.7-flash'
  );
  if (queryModel !== STABLE_GEMINI_MODEL && !fallbackModels.includes(STABLE_GEMINI_MODEL)) {
    fallbackModels.push(STABLE_GEMINI_MODEL);
  }
  const searxngInstancesList = searxngInstances();
  const port = num('PORT', 8787, 1, 65535);
  const authorityWeight = num('RANK_AUTHORITY_WEIGHT', 0.04, 0, 0.05);
  return {
    keys: {
      serper: process.env.SERPER_API_KEY,
      serpapi: process.env.SERPAPI_API_KEY,
      exa: process.env.EXA_API_KEY,
      firecrawl: process.env.FIRECRAWL_API_KEY
    },
    searxngEnabled: bool('SEARXNG_ENABLED', searxngInstancesList.length > 0),
    searxngInstances: searxngInstancesList,
    searxngUrl: searxngInstancesList[0] || '',
    searxngRetries: num('SEARXNG_RETRIES', 0, 0, 3),
    // SearXNG is a fallback layer. Keep its public-instance budget isolated
    // from the slower timeout used by primary providers so it can never add
    // several seconds to every search when public instances are unhealthy.
    searxngTimeoutMs: num('SEARXNG_TIMEOUT_MS', 1800, 250, 10000),
    providerTimeoutMs: num('PROVIDER_TIMEOUT_MS', 10000, 1),
    scrapeTimeoutMs: num('SCRAPE_TIMEOUT_MS', 30000, 1),
    cacheTtlMs: num('CACHE_TTL_SECONDS', 900) * 1000,
    scrapeCacheTtlMs: num('SCRAPE_CACHE_TTL_SECONDS', 3600) * 1000,
    cacheMax: num('CACHE_MAX_ENTRIES', 500, 1),
    weights: {
      serper: num('WEIGHT_SERPER', 1),
      serpapi: num('WEIGHT_SERPAPI', 1),
      exa: num('WEIGHT_EXA', 1.05),
      'omni-index': num('WEIGHT_OMNI_INDEX', 1.15),
      searxng: num('WEIGHT_SEARXNG', 0.8)
    },
    breakerThreshold: num('BREAKER_THRESHOLD', 3, 1),
    breakerCooldownMs: num('BREAKER_COOLDOWN_MS', 30000, 1),
    ranking: {
      authorityWeight,
      qualityDomains: domains(
        process.env.RANK_QUALITY_DOMAINS,
        'docs.python.org,fastapi.tiangolo.com,developer.mozilla.org,w3.org,git-scm.com,docs.docker.com,postgresql.org,nodejs.org,react.dev,typescriptlang.org,python.org'
      )
    },
    crawler: {
      timeoutMs: num('CRAWLER_TIMEOUT_MS', 8000, 1),
      delayMs: num('CRAWLER_DELAY_MS', 1000),
      maxConcurrency: num('CRAWLER_CONCURRENCY', 4, 1, 64),
      userAgent: process.env.CRAWLER_USER_AGENT || 'OmniBot/1.0'
    },
    indexFile: path.resolve(process.env.OMNI_INDEX_FILE || 'data/omni-index.json'),
    frontierFile: path.resolve(process.env.OMNI_FRONTIER_FILE || 'data/crawl-frontier.json'),
    server: {
      port,
      host: process.env.HOST || '127.0.0.1',
      allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      apiToken: process.env.OMNI_API_TOKEN || '',
      rateLimitPerMinute: num('RATE_LIMIT_PER_MINUTE', 30, 1)
    },
    crawl: {
      maxPages: num('CRAWL_MAX_PAGES', 25, 1),
      maxDepth: num('CRAWL_MAX_DEPTH', 2),
      sameOrigin: !bool('CRAWL_ALLOW_EXTERNAL', false)
    },
    ai: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: queryModel,
      fallbackModels,
      timeoutMs: num('GEMINI_TIMEOUT_MS', 30000, 1),
      maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 4000, 128),
      maxRetries: num('GEMINI_MAX_RETRIES', 3),
      retryBaseMs: num('GEMINI_RETRY_BASE_MS', 1000, 1),
      maxRetryDelayMs: num('GEMINI_MAX_RETRY_DELAY_MS', 15000, 1),
      breakerThreshold: num('GEMINI_BREAKER_THRESHOLD', 3, 1),
      breakerCooldownMs: num('GEMINI_BREAKER_COOLDOWN_MS', 30000, 1),
      cacheTtlMs: num('GEMINI_CACHE_TTL_SECONDS', 604800) * 1000,
      cacheMaxEntries: num('GEMINI_CACHE_MAX_ENTRIES', 2000, 1),
      cacheFile: path.resolve(process.env.GEMINI_CACHE_FILE || 'data/gemini-query-cache.json'),
      corpusFile: path.resolve(process.env.OMNI_QUERY_CORPUS_FILE || 'data/query-corpus.json')
    }
  };
}

export { DEFAULT_SEARXNG_INSTANCES };
