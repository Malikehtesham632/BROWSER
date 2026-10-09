import { TTLCache } from "./core/cache.js";
import { CircuitBreaker } from "./core/circuit.js";
import { OmniError } from "./core/errors.js";
import { fuseResults } from "./core/rank.js";
import { canonicalUrlKey, isPublicHttpUrl } from "./core/url.js";
import { searchSerper, searchSerpApi, searchExa, createSearxngProvider, scrapeWithFirecrawl } from "./providers/index.js";
import { analyzeQuery, queryFeatures } from "./query/analyzer.js";
import { rankIndexed } from "./index/rank.js";
import { rerankResults } from "./ranking/engine.js";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function normalizeQuery(query) {
  const q = typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
  if (!q) throw new OmniError("BAD_QUERY", "Query is empty", 400);
  if (q.length > 300) throw new OmniError("BAD_QUERY", "Query is too long (max 300 characters)", 400);
  return q;
}

export function buildProviders(config, fetchImpl, logger = console) {
  const shared = options => ({ timeoutMs: config.providerTimeoutMs, fetchImpl, ...options });
  const providers = [];
  if (config.keys.serper)
    providers.push({ name: "serper", tier: "primary", run: (query, options) => searchSerper(query, config.keys.serper, shared(options)) });
  if (config.keys.serpapi)
    providers.push({ name: "serpapi", tier: "primary", run: (query, options) => searchSerpApi(query, config.keys.serpapi, shared(options)) });
  if (config.keys.exa)
    providers.push({ name: "exa", tier: "primary", run: (query, options) => searchExa(query, config.keys.exa, shared(options)) });

  const instances = config.searxngInstances ?? (config.searxngUrl ? [config.searxngUrl] : []);
  const enabled = config.searxngEnabled ?? instances.length > 0;
  if (enabled && instances.length) {
    const client = createSearxngProvider(instances, {
      timeoutMs: config.providerTimeoutMs,
      retries: config.searxngRetries ?? 1,
      fetchImpl,
      logger
    });
    providers.push({ name: "searxng", tier: "primary", run: client.run, health: client.health });
  }
  return providers;
}

export function createSearchEngine(config, deps = {}) {
  const logger = deps.logger ?? console;
  const providers = deps.providers ?? buildProviders(config, deps.fetchImpl, logger);
  const cache = deps.cache ?? new TTLCache({ max: config.cacheMax, ttlMs: config.cacheTtlMs });
  const scrapeCache = deps.scrapeCache ?? new TTLCache({ max: 100, ttlMs: config.scrapeCacheTtlMs });
  const breaker = deps.breaker ?? new CircuitBreaker({ threshold: config.breakerThreshold, cooldownMs: config.breakerCooldownMs });
  const inflight = new Map();
  const store = deps.store;
  const providerStates = new Map();

  function stateFor(name) {
    if (!providerStates.has(name)) {
      providerStates.set(name, {
        name,
        healthy: null,
        latencyMs: null,
        failures: 0,
        consecutiveFailures: 0,
        lastSuccessfulRequest: null,
        lastError: null,
        circuitOpen: false
      });
    }
    return providerStates.get(name);
  }

  function healthFor(provider) {
    return { ...stateFor(provider.name), instances: provider.health?.() ?? [] };
  }

  async function callProvider(provider, query, ctx) {
    const started = Date.now();
    const state = stateFor(provider.name);
    if (breaker.isOpen(provider.name)) {
      state.circuitOpen = true;
      const result = { name: provider.name, ok: false, skipped: true, count: 0, ms: 0, error: "circuit open" };
      ctx.providers[provider.name] = result;
      ctx.onProvider?.({ provider: result, results: ctx.fuse() });
      logger.warn?.(`[${provider.name}] request skipped; circuit open`);
      return;
    }

    try {
      const results = await provider.run(query, {
        num: ctx.num,
        timeoutMs: config.providerTimeoutMs
      });
      const ms = Date.now() - started;
      breaker.success(provider.name);
      if (state.circuitOpen) logger.info?.(`[${provider.name}] circuit closed after successful request`);
      state.healthy = true;
      state.latencyMs = ms;
      state.consecutiveFailures = 0;
      state.lastSuccessfulRequest = new Date().toISOString();
      state.lastError = null;
      state.circuitOpen = false;
      ctx.lists.push({ source: provider.name, results });
      const result = { name: provider.name, ok: true, count: results.length, ms };
      ctx.providers[provider.name] = result;
      ctx.onProvider?.({ provider: result, results: ctx.fuse() });
    } catch (error) {
      const ms = Date.now() - started;
      breaker.failure(provider.name);
      state.healthy = false;
      state.latencyMs = ms;
      state.failures++;
      state.consecutiveFailures++;
      state.lastError = provider.name === "searxng"
        ? String(error?.message ?? error).slice(0, 200)
        : error?.status ? `${provider.name} HTTP ${error.status}` : `${provider.name} request failed`;
      state.circuitOpen = breaker.isOpen(provider.name);
      const result = { name: provider.name, ok: false, count: 0, ms, error: state.lastError };
      ctx.providers[provider.name] = result;
      ctx.onProvider?.({ provider: result, results: ctx.fuse() });
      logger.warn?.(`[${provider.name}] request failed latencyMs=${ms}${error?.status ? ` status=${error.status}` : ""}${provider.name === "searxng" ? ` error=${state.lastError}` : ""}`);
      if (state.circuitOpen) logger.warn?.(`[${provider.name}] circuit opened`);
    }
  }

  async function execute(query, key, options) {
    const started = Date.now();
    const num = clamp(Number(options.num) || 10, 1, 20);
    const limit = clamp(Number(options.limit) || 20, 1, 50);
    const analysis = queryFeatures(analyzeQuery(query));
    const ctx = {
      num,
      lists: [],
      providers: {},
      onProvider: options.onProvider,
      fuse: () => fuseResults(ctx.lists, { limit, weights: config.weights })
    };

    if (store) {
      const own = rankIndexed(store.candidates(analysis.terms), analysis, { limit });
      if (own.length) {
        ctx.lists.push({
          source: "omni-index",
          results: own.map(result => ({
            url: result.url,
            title: result.title,
            snippet: result.description || result.content?.slice(0, 300),
            publishedAt: result.indexedAt,
            score: result.score,
            source: "omni-index"
          }))
        });
      }
    }

    const primary = providers.filter(provider => provider.tier !== "fallback");
    const fallback = providers.filter(provider => provider.tier === "fallback");
    await Promise.all(primary.map(provider => callProvider(provider, query, ctx)));
    if ((!ctx.lists.some(list => list.results.length) || Object.values(ctx.providers).some(provider => !provider.ok)) && fallback.length)
      await Promise.all(fallback.map(provider => callProvider(provider, query, ctx)));

    let results = ctx.fuse();
    if (analysis.site) {
      results = results.filter(result => {
        try {
          const host = new URL(result.url).hostname.toLowerCase();
          return host === analysis.site || host.endsWith(`.${analysis.site}`);
        } catch {
          return false;
        }
      });
    }
    results = rerankResults(results, analysis, { limit, ...config.ranking });
    const output = {
      query,
      analysis: { intent: analysis.intent, terms: analysis.terms, phrases: analysis.phrases, site: analysis.site },
      results,
      providers: ctx.providers,
      cached: false,
      tookMs: Date.now() - started
    };
    if (output.results.length) cache.set(key, output);
    return output;
  }

  async function search(query, options = {}) {
    const normalized = normalizeQuery(query);
    const num = clamp(Number(options.num) || 10, 1, 20);
    const limit = clamp(Number(options.limit) || 20, 1, 50);
    const key = `${normalized.toLowerCase()}|${num}|${limit}|${store?.stats?.().revision || 0}`;
    if (!options.fresh) {
      const hit = cache.get(key);
      if (hit) return { ...hit, cached: true, tookMs: 0 };
      const running = inflight.get(key);
      if (running) return running.then(result => ({ ...result, cached: true }));
    }
    const run = execute(normalized, key, options).finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
    inflight.set(key, run);
    return run;
  }

  async function scrape(url, options = {}) {
    if (!isPublicHttpUrl(url)) throw new OmniError("BAD_URL", "URL must be a public http(s) address", 400);
    if (!config.keys.firecrawl) throw new OmniError("NO_SCRAPER", "Page extraction is not configured", 503);
    const key = canonicalUrlKey(url);
    if (!options.fresh) {
      const hit = scrapeCache.get(key);
      if (hit) return { ...hit, cached: true };
    }
    const page = await scrapeWithFirecrawl(url, config.keys.firecrawl, {
      timeoutMs: config.scrapeTimeoutMs,
      fetchImpl: deps.fetchImpl
    });
    scrapeCache.set(key, page);
    return { ...page, cached: false };
  }

  return {
    search,
    scrape,
    providerNames: () => providers.map(provider => provider.name),
    providerHealth: () => Object.fromEntries(providers.map(provider => [provider.name, healthFor(provider)])),
    indexStats: () => store?.stats?.() ?? { documents: 0, terms: 0, words: 0 }
  };
}
