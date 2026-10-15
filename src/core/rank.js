import { canonicalUrlKey } from './url.js';

export function fuseResults(lists, { k = 60, weights = {}, limit = 20 } = {}) {
  const merged = new Map();
  for (const { source, results = [] } of lists) {
    const weight = weights[source] ?? 1;
    results.forEach((result, index) => {
      const key = canonicalUrlKey(result.url);
      if (!key) return;
      const rank = result.rank ?? index + 1;
      let e = merged.get(key);
      if (!e) {
        e = {
          url: result.url,
          title: result.title || '',
          snippet: result.snippet || '',
          source,
          sources: [],
          publishedAt: result.publishedAt ?? null,
          score: 0,
          ranks: {}
        };
        merged.set(key, e);
      }
      const incomingEngines = Array.isArray(result.engines)
        ? result.engines
        : (typeof result.engine === 'string' && result.engine ? [result.engine] : []);
      if (incomingEngines.length) {
        e.engines ??= [];
        for (const engine of incomingEngines) {
          if (typeof engine === 'string' && engine.trim() && !e.engines.includes(engine.trim())) {
            e.engines.push(engine.trim());
          }
        }
        if (!e.engine && typeof result.engine === 'string' && result.engine.trim()) {
          e.engine = result.engine.trim();
        }
        if (!e.engine && e.engines.length) e.engine = e.engines[0];
      }
      // Multiple SearXNG engines may return the same URL within one provider.
      // Preserve that engine metadata even when rank/source is deduplicated.
      if (e.ranks[source] !== undefined) return;
      e.ranks[source] = rank;
      e.sources.push(source);
      e.score += weight / (k + rank);
      if (!e.title && result.title) e.title = result.title;
      if ((result.snippet || '').length > e.snippet.length) e.snippet = result.snippet;
      if (!e.publishedAt && result.publishedAt) e.publishedAt = result.publishedAt;
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || b.sources.length - a.sources.length)
    .slice(0, limit)
    .map((e) => ({ ...e, score: Math.round(e.score * 1e5) / 1e5 }));
}
