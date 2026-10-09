import { fetchJson, ProviderError } from "./http.js";
import { normalizeResults } from "./normalize.js";

function normalizeInstance(instance) {
  let url;
  try {
    url = new URL(instance);
  } catch {
    throw new Error(`Invalid SearXNG instance URL: ${String(instance)}`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error(`SearXNG instance must be a credential-free HTTP(S) base URL: ${String(instance)}`);
  return url.href.replace(/\/+$/, "");
}

export async function searchSearxng(query, baseUrl, opts = {}) {
  if (!baseUrl) throw new Error("SEARXNG_URL is missing");
  const instance = normalizeInstance(baseUrl);
  const url = new URL(`${instance}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  let data;
  try {
    data = await fetchJson(url.href, {
      provider: "searxng",
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      maxTotalMs: opts.totalTimeoutMs,
      fetchImpl: opts.fetchImpl,
      headers: { Accept: "application/json" },
      includeErrorBody: false
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("searxng connection failed", { provider: "searxng", retryable: true });
  }

  if (!data || typeof data !== "object" || !Array.isArray(data.results))
    throw new ProviderError("searxng returned an invalid response: expected a results array", { provider: "searxng" });

  const results = normalizeResults(data.results.slice(0, opts.num ?? 10), "searxng", opts);
  if (data.results.length && !results.length)
    throw new ProviderError("searxng returned results without valid URLs", { provider: "searxng" });
  return results;
}

export function createSearxngProvider(instances, {
  timeoutMs = 4000,
  retries = 1,
  fetchImpl = globalThis.fetch,
  logger = console,
  now = Date.now
} = {}) {
  const urls = [...new Set((instances || []).map(normalizeInstance))];
  if (!urls.length) throw new Error("At least one SearXNG instance is required");

  const states = urls.map(url => ({
    instance: url,
    healthy: null,
    latencyMs: null,
    failures: 0,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastError: null
  }));
  let cursor = 0;

  async function run(query, { num = 10 } = {}) {
    let lastError;
    const start = cursor;
    cursor = (cursor + 1) % urls.length;
    const deadline = now() + timeoutMs;

    for (let offset = 0; offset < urls.length; offset++) {
      const index = (start + offset) % urls.length;
      const url = urls[index];
      const state = states[index];
      const started = now();
      const remaining = deadline - now();
      if (remaining <= 0) break;

      logger.info?.(`[searxng] request started instance=${new URL(url).host}`);
      try {
        const results = await searchSearxng(query, url, {
          num,
          timeoutMs: Math.min(timeoutMs, remaining),
          totalTimeoutMs: remaining,
          retries,
          fetchImpl
        });
        state.healthy = true;
        state.latencyMs = Math.max(0, now() - started);
        state.lastSuccessAt = new Date(now()).toISOString();
        state.consecutiveFailures = 0;
        state.lastError = null;
        logger.info?.(`[searxng] request succeeded instance=${new URL(url).host} latencyMs=${state.latencyMs} results=${results.length}`);
        return results;
      } catch (error) {
        state.healthy = false;
        state.latencyMs = Math.max(0, now() - started);
        state.failures++;
        state.consecutiveFailures++;
        state.lastError = String(error?.message ?? error).slice(0, 200);
        lastError = error;
        logger.warn?.(`[searxng] request failed instance=${new URL(url).host} latencyMs=${state.latencyMs} error=${state.lastError}`);
      }
    }

    if (now() >= deadline)
      throw new ProviderError(`searxng timed out after ${timeoutMs}ms`, { provider: "searxng" });
    throw lastError || new ProviderError(`searxng timed out after ${timeoutMs}ms`, { provider: "searxng" });
  }

  return { run, health: () => states.map(state => ({ ...state })) };
}
