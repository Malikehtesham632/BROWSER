import { fetchJson, ProviderError } from './http.js';
import { normalizeSearchResult } from './normalize.js';

function normalizeInstanceUrl(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl || '').trim());
  } catch {
    throw new ProviderError('searxng URL is invalid', { provider: 'searxng' });
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ProviderError('searxng URL must be a valid HTTP(S) URL without embedded credentials', {
      provider: 'searxng'
    });
  }

  // Allow reverse-proxy deployments under a subpath, e.g. https://host/searx/.
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`.replace(/^\/\//, '/');
  url.search = '';
  url.hash = '';
  return url;
}

export async function searchSearxng(query, baseUrl, opts = {}) {
  if (!baseUrl) throw new ProviderError('SEARXNG_URL is missing', { provider: 'searxng' });

  const url = normalizeInstanceUrl(baseUrl);
  url.searchParams.set('q', String(query));
  url.searchParams.set('format', 'json');

  const data = await fetchJson(url.toString(), {
    provider: 'searxng',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
    retryBaseMs: opts.retryBaseMs,
    fetchImpl: opts.fetchImpl,
    headers: { Accept: 'application/json', ...(opts.headers || {}) }
  });

  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    throw new ProviderError('searxng returned an invalid response: expected a results array', {
      provider: 'searxng'
    });
  }

  const normalized = [];
  for (const item of data.results.slice(0, opts.num ?? 10)) {
    const result = normalizeSearchResult(item, 'searxng', normalized.length + 1);
    if (!result) continue;

    const engines = Array.isArray(item.engines)
      ? [...new Set(item.engines.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
      : [];
    if (typeof item.engine === 'string' && item.engine.trim()) {
      result.engine = item.engine.trim();
      if (engines.length && !engines.includes(result.engine)) engines.unshift(result.engine);
    }
    if (engines.length) {
      result.engines = engines;
      if (!result.engine) result.engine = engines[0];
    }
    normalized.push(result);
  }
  return normalized;
}

/**
 * Try configured SearXNG instances in order. Network failures are reported
 * without exposing the query or upstream response body. A single timeout
 * budget is shared across the list so dead instances cannot stall forever.
 */
export function createSearxngProvider(instances, defaults = {}) {
  const urls = (Array.isArray(instances) ? instances : String(instances || '').split(','))
    .map((value) => String(value).trim())
    .filter(Boolean);
  const logger = defaults.logger || console;
  const health = urls.map((url) => ({
    url,
    healthy: null,
    failures: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastSuccessAt: null,
    latencyMs: null
  }));

  async function run(query, overrides = {}) {
    if (!urls.length) throw new ProviderError('SEARXNG_URL is missing', { provider: 'searxng' });

    const options = { ...defaults, ...overrides };
    const timeoutMs = Number(options.timeoutMs ?? 8000);
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let lastError = null;

    for (let index = 0; index < urls.length; index++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        lastError = new ProviderError(`searxng timed out after ${timeoutMs}ms`, { provider: 'searxng' });
        break;
      }

      const state = health[index];
      const instanceStartedAt = Date.now();
      try {
        logger.info?.(`[SearXNG] instance ${index + 1}/${urls.length} request started`);
        const results = await searchSearxng(query, urls[index], {
          ...options,
          timeoutMs: remainingMs,
          // Do not allow per-instance retries to exceed the shared budget.
          retries: 0
        });
        state.healthy = true;
        state.consecutiveFailures = 0;
        state.lastError = null;
        state.lastSuccessAt = new Date().toISOString();
        state.latencyMs = Date.now() - instanceStartedAt;
        logger.info?.(`[SearXNG] instance ${index + 1}/${urls.length} request succeeded (${results.length} results)`);
        return results;
      } catch (error) {
        const message = error instanceof ProviderError
          ? error.message
          : `searxng connection failed${error?.cause?.code ? ` (${error.cause.code})` : ''}`;
        state.healthy = false;
        state.failures++;
        state.consecutiveFailures++;
        state.lastError = message.slice(0, 120);
        state.latencyMs = Date.now() - instanceStartedAt;
        lastError = error instanceof ProviderError
          ? error
          : new ProviderError(message, { provider: 'searxng', cause: error });
        logger.warn?.(`[SearXNG] instance ${index + 1}/${urls.length} request failed: ${state.lastError}`);

        // A consumed timeout budget is not reset for later instances.
        if (Date.now() >= deadline || /timed out after/i.test(state.lastError)) break;
      }
    }

    throw lastError || new ProviderError('searxng request failed', { provider: 'searxng' });
  }

  return {
    name: 'searxng',
    run,
    health: () => health.map((entry) => ({ ...entry })),
    getHealth: () => health.map((entry) => ({ ...entry }))
  };
}
