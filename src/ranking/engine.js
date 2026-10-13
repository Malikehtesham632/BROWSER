import { canonicalUrlKey } from '../core/url.js';
import { tokenSet } from '../core/tokenize.js';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const TRUSTED_SUFFIXES = new Set(['gov', 'edu', 'org']);
export const DEFAULT_QUALITY_DOMAINS = [
  'docs.python.org',
  'fastapi.tiangolo.com',
  'developer.mozilla.org',
  'w3.org',
  'git-scm.com',
  'docs.docker.com',
  'postgresql.org',
  'nodejs.org',
  'react.dev',
  'typescriptlang.org',
  'python.org'
];
export const DEFAULT_AUTHORITY_WEIGHT = 0.04;
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
function domainQuality(host, qualityDomains) {
  if (!host) return 0;
  if (qualityDomains.has(host)) return 1;
  const tld = host.split('.').at(-1);
  return TRUSTED_SUFFIXES.has(tld) ? 0.82 : 0.55;
}
function freshness(publishedAt) {
  if (!publishedAt) return 0.5;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (Date.now() - t) / 86400000);
  return 1 / (1 + days / 365);
}
function lexicalFeatures(result, q) {
  const title = String(result.title || '');
  const text = `${title} ${result.snippet || ''}`;
  const titleTokens = tokenSet(title);
  const textTokens = tokenSet(text);
  const lowerText = text.toLowerCase();
  const terms = [...new Set(q.terms || [])];
  const phraseFound = (q.phrases || []).some((p) => lowerText.includes(String(p).toLowerCase()));
  if (!terms.length) return { coverage: 0, titleCoverage: 0, phrase: phraseFound ? 1 : 0 };
  let found = 0;
  let titleFound = 0;
  for (const term of terms) {
    if (textTokens.has(term)) found++;
    if (titleTokens.has(term)) titleFound++;
  }
  return {
    coverage: found / terms.length,
    titleCoverage: titleFound / terms.length,
    phrase: phraseFound ? 1 : 0
  };
}
export function rerankResults(
  results,
  q,
  {
    limit = 20,
    authorityWeight = DEFAULT_AUTHORITY_WEIGHT,
    qualityDomains = DEFAULT_QUALITY_DOMAINS
  } = {}
) {
  const weight =
    Number.isFinite(authorityWeight) && authorityWeight >= 0
      ? authorityWeight
      : DEFAULT_AUTHORITY_WEIGHT;
  const trustedHosts = new Set(qualityDomains);
  const dedup = new Map();
  for (const result of results || []) {
    const key = canonicalUrlKey(result.url);
    if (!key) continue;
    const old = dedup.get(key);
    if (!old) {
      dedup.set(key, { ...result });
      continue;
    }
    const sources = [
      ...new Set(
        [...(old.sources || []), ...(result.sources || []), old.source, result.source].filter(
          Boolean
        )
      )
    ];
    dedup.set(key, {
      ...old,
      sources,
      snippet:
        String(result.snippet || '').length > String(old.snippet || '').length
          ? result.snippet
          : old.snippet
    });
  }
  const maxBase = Math.max(...[...dedup.values()].map((r) => Number(r.score) || 0), 0.000001);
  return [...dedup.values()]
    .map((r) => {
      const f = lexicalFeatures(r, q),
        providerAgreement = clamp(((r.sources?.length || 1) - 1) / 3, 0, 1),
        base = clamp((Number(r.score) || 0) / maxBase, 0, 1),
        authority = domainQuality(hostOf(r.url), trustedHosts),
        fresh = freshness(r.publishedAt),
        penalty = /\b(tag|category|login|signup|privacy|terms)\b/i.test(String(r.title || ''))
          ? 0.05
          : 0;
      const score =
        base * 0.22 +
        f.coverage * 0.24 +
        f.titleCoverage * 0.18 +
        f.phrase * 0.12 +
        authority * weight +
        providerAgreement * 0.08 +
        fresh * 0.06 -
        penalty;
      return {
        ...r,
        score,
        ranking: {
          baseRelevance: base,
          termCoverage: f.coverage,
          titleCoverage: f.titleCoverage,
          phraseMatch: f.phrase,
          authority,
          freshness: fresh,
          providerAgreement,
          penalty
        }
      };
    })
    .sort((a, b) => b.score - a.score || (b.sources?.length || 0) - (a.sources?.length || 0))
    .slice(0, limit);
}
