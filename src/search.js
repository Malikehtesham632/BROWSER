import { TTLCache } from './core/cache.js';
import { CircuitBreaker } from './core/circuit.js';
import { OmniError } from './core/errors.js';
import { fuseResults } from './core/rank.js';
import { canonicalUrlKey, isPublicHttpUrl } from './core/url.js';
import {
  searchSerper,
  searchSerpApi,
  searchExa,
  createSearxngProvider,
  scrapeWithFirecrawl
} from './providers/index.js';
import { analyzeQuery, queryFeatures } from './query/analyzer.js';
import { rankIndexed } from './index/rank.js';
import { rerankResults } from './ranking/engine.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function normalizeQuery(query) {
  const q = typeof query === 'string' ? query.replace(/\s+/g, ' ').trim() : '';
  if (!q) throw new OmniError('BAD_QUERY', 'Query is empty', 400);
  if (q.length > 300)
    throw new OmniError('BAD_QUERY', 'Query is too long (max 300 characters)', 400);
  return q;
}

export function buildProviders(config, fetchImpl, logger = console) {
  const shared = (options) => ({ timeoutMs: config.providerTimeoutMs, fetchImpl, ...options });
  const providers = [];
  if (config.keys.serper)
    providers.push({
      name: 'serper',
      tier: 'primary',
      run: (query, options) => searchSerper(query, config.keys.serper, shared(options))
    });
  if (config.keys.serpapi)
    providers.push({
      name: 'serpapi',
      tier: 'primary',
      run: (query, options) => searchSerpApi(query, config.keys.serpapi, shared(options))
    });
  if (config.keys.exa)
    providers.push({
      name: 'exa',
      tier: 'primary',
      run: (query, options) => searchExa(query, config.keys.exa, shared(options))
    });

  const instances = config.searxngInstances ?? (config.searxngUrl ? [config.searxngUrl] : []);
  const enabled = config.searxngEnabled ?? instances.length > 0;
  if (enabled && instances.length) {
    const client = createSearxngProvider(instances, {
      timeoutMs: config.searxngTimeoutMs ?? 1800,
      maxTimeoutMs: config.searxngTimeoutMs ?? 1800,
      retries: config.searxngRetries ?? 0,
      fetchImpl,
      logger
    });
    providers.push({ name: 'searxng', tier: 'primary', run: client.run, health: client.health });
  }
  return providers;
}

export function createSearchEngine(config, deps = {}) {
  const logger = deps.logger ?? console;
  const providers = deps.providers ?? buildProviders(config, deps.fetchImpl, logger);
  const cache = deps.cache ?? new TTLCache({ max: config.cacheMax, ttlMs: config.cacheTtlMs });
  const scrapeCache =
    deps.scrapeCache ?? new TTLCache({ max: 100, ttlMs: config.scrapeCacheTtlMs });
  const breaker =
    deps.breaker ??
    new CircuitBreaker({
      threshold: config.breakerThreshold,
      cooldownMs: config.breakerCooldownMs
    });
  const inflight = new Map();
