import { fetchJson, ProviderError } from './http.js';
import { normalizeResults } from './normalize.js';

function normalizeInstance(instance) {
  let url;
  try {
    url = new URL(instance);
  } catch {
    throw new Error(`Invalid SearXNG instance URL: ${String(instance)}`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `SearXNG instance must be a credential-free HTTP(S) base URL: ${String(instance)}`
    );
  return url.href.replace(/\/+$/, '');
}

export async function searchSearxng(query, baseUrl, opts = {}) {
  if (!baseUrl) throw new Error('SEARXNG_URL is missing');
  const instance = normalizeInstance(baseUrl);
  const url = new URL(`${instance}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  let data;
  try {
    data = await fetchJson(url.href, {
      provider: 'searxng',
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      maxTotalMs: opts.totalTimeoutMs,
      fetchImpl: opts.fetchImpl,
      headers: { Accept: 'application/json' },
      includeErrorBody: false
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('searxng connection failed', { provider: 'searxng', retryable: true });
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.results))
    throw new ProviderError('searxng returned an invalid response: expected a results array', {
      provider: 'searxng'
    });

  const results = normalizeResults(data.results.slice(0, opts.num ?? 10), 'searxng', opts);
  if (data.results.length && !results.length)
    throw new ProviderError('searxng returned results without valid URLs', { provider: 'searxng' });
  return results;
}

function cooldownFor(error, cooldownMs) {
  const status = Number(error?.status);
  if ([403, 418, 429].includes(status)) return Math.max(cooldownMs * 4, 120000);
  return cooldownMs;
}

export function createSearxngProvider(
  instances,
  {
    timeoutMs = 2500,
    retries = 0,
    cooldownMs = 60000,
    maxInstancesPerRequest = Infinity,
    maxTimeoutMs = 2500,
    fetchImpl = globalThis.fetch,
    logger = console,
    now = Date.now
  } = {}
) {
  const urls = [...new Set((instances || []).map(normalizeInstance))];
  if (!urls.length) throw new Error('At least one SearXNG instance is required');

  const requestTimeoutMs = Math.min(Math.max(1, timeoutMs), Math.max(1, maxTimeoutMs));
  const states = urls.map((url) => ({
    instance: url,
    healthy: null,
    latencyMs: null,
    failures: 0,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastError: null,
    cooldownUntil: 0
  }));
  let cursor = 0;

  function candidates() {
    const available = states
      .map((state, index) => ({ state, index }))
      .filter(({ state }) => state.cooldownUntil <= now());
    if (!available.length) return [];

    // Prefer known-healthy instances, then unknown instances, and only then
    // previously failed instances whose cooldown has expired.
    available.sort((a, b) => {
      const healthRank = (state) => (state.healthy === true ? 0 : state.healthy === null ? 1 : 2);
      const healthDelta = healthRank(a.state) - healthRank(b.state);
      if (healthDelta) return healthDelta;
      const latencyA = a.state.latencyMs ?? Number.MAX_SAFE_INTEGER;
      const latencyB = b.state.latencyMs ?? Number.MAX_SAFE_INTEGER;
      return latencyA - latencyB;
    });

    const startIndex = available.findIndex(({ index }) => index === cursor);
    if (startIndex > 0) return available.slice(startIndex).concat(available.slice(0, startIndex));
    return available;
  }

  async function run(query, { num = 10 } = {}) {
    let lastError;
    const deadline = now() + requestTimeoutMs;
    const selected = candidates().slice(0, Math.max(1, maxInstancesPerRequest));

    if (!selected.length) {
      throw new ProviderError('searxng all instances are cooling down', { provider: 'searxng' });
    }

    for (const { index, state } of selected) {
      const url = urls[index];
      const started = now();
      const remaining = deadline - now();
      if (remaining <= 0) break;
      cursor = (index + 1) % urls.length;

      logger.info?.(`[searxng] request started instance=${new URL(url).host}`);
      try {
        const results = await searchSearxng(query, url, {
          num,
          timeoutMs: Math.min(requestTimeoutMs, remaining),
          totalTimeoutMs: remaining,
          retries,
          fetchImpl
        });
        state.healthy = true;
        state.latencyMs = Math.max(0, now() - started);
        state.lastSuccessAt = new Date(now()).toISOString();
        state.consecutiveFailures = 0;
        state.lastError = null;
        state.cooldownUntil = 0;
        logger.info?.(
          `[searxng] request succeeded instance=${new URL(url).host} latencyMs=${state.latencyMs} results=${results.length}`
        );
        return results;
      } catch (error) {
        state.healthy = false;
        state.latencyMs = Math.max(0, now() - started);
        state.failures++;
        state.consecutiveFailures++;
        state.lastError = String(error?.message ?? error).slice(0, 200);
        state.cooldownUntil = now() + cooldownFor(error, cooldownMs);
        lastError = error;
        logger.warn?.(
          `[searxng] request failed instance=${new URL(url).host} latencyMs=${state.latencyMs} error=${state.lastError}`
        );
      }
    }

    if (now() >= deadline)
      throw new ProviderError(`searxng timed out after ${requestTimeoutMs}ms`, { provider: 'searxng' });
    throw (
      lastError ||
      new ProviderError(`searxng timed out after ${requestTimeoutMs}ms`, { provider: 'searxng' })
    );
  }

  return { run, health: () => states.map((state) => ({ ...state })) };
}
