const IP_OR_HOST =
  /^(?:localhost|(?:\[[\da-f:]+\])|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[\w-]+)(?::\d+)?(?:[/?#]|$)/i;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function addressUrl(value) {
  const input = String(value ?? '').trim();
  if (!input || /\s/.test(input)) return null;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return null;
  if (IP_OR_HOST.test(input)) return `https://${input}`;
  return null;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function displayUrl(url) {
  const text = String(url ?? '');
  if (!/^https?:\/\//i.test(text)) return text;
  try {
    const parsed = new URL(text);
    const path = parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : parsed.pathname;
    const rest = `${path}${parsed.search}${parsed.hash}`;
    const host = parsed.host.replace(/^www\./, '');
    return parsed.protocol === 'https:' ? `${host}${rest}` : `http://${host}${rest}`;
  } catch {
    return text;
  }
}

export function hueFor(text) {
  let hash = 0;
  for (const char of String(text ?? '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

export function letterFor(text) {
  const clean = String(text ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .trim();
  const first = [...clean][0];
  return first ? first.toUpperCase() : 'N';
}

export function groupHistory(entries, now = Date.now()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 86400000;
  const buckets = [
    { label: 'Today', from: today, items: [] },
    { label: 'Yesterday', from: today - day, items: [] },
    { label: 'Last 7 days', from: today - 7 * day, items: [] },
    { label: 'Older', from: -Infinity, items: [] }
  ];
  for (const entry of entries) {
    const time = Number(entry.lastVisit) || 0;
    const bucket =
      buckets.find((candidate) => time >= candidate.from) || buckets[buckets.length - 1];
    bucket.items.push(entry);
  }
  return buckets
    .filter((bucket) => bucket.items.length)
    .map(({ label, items }) => ({ label, items }));
}

export function searchProgress({ stage = 'start', done = 0, total = 0 } = {}) {
  if (stage === 'finished') return 100;
  if (stage === 'ranking') return 92;
  const count = Math.max(0, total);
  if (!count) return stage === 'start' ? 12 : 40;
  const ratio = clamp(done / count, 0, 1);
  return Math.round(12 + ratio * 72);
}

export function searchStep({ stage = 'start', done = 0, total = 0 } = {}) {
  if (stage === 'finished') return 4;
  if (stage === 'ranking') return 3;
  if (total > 0 && done >= total) return 3;
  if (done > 0) return 2;
  return 1;
}

export function formatSeconds(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

export function newDomains(results, seen, limit = 6) {
  const found = [];
  for (const result of results || []) {
    const host = hostOf(result?.url);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    found.push(host);
    if (found.length >= limit) break;
  }
  return found;
}

export function providerLabel(name) {
  const labels = {
    serper: 'Google · Serper',
    serpapi: 'Google · SerpApi',
    exa: 'Exa',
    searxng: 'SearXNG',
    'omni-index': 'Nova index'
  };
  if (labels[name]) return labels[name];
  const text = String(name ?? '');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Source';
}

export function providerShort(name) {
  const shorts = { serper: 'Se', serpapi: 'Sa', exa: 'Ex', searxng: 'Sx', 'omni-index': 'Ix' };
  return shorts[name] || letterFor(name);
}

export function nextIndex(current, length, delta) {
  if (length <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}
