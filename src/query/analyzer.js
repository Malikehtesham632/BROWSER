import { tokenize, STOP_WORDS } from '../core/tokenize.js';
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function analyzeQuery(input) {
  const raw = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return { raw: '', terms: [], phrases: [], site: null, intent: 'informational' };
  const phrases = [];
  const without = raw.replace(/"([^"]+)"/g, (_, p) => {
    phrases.push(p.trim());
    return ' ';
  });
  let site = null;
  const siteMatch = without.match(/(?:^|\s)site:([^\s]+)/i);
  if (siteMatch) {
    site = siteMatch[1].toLowerCase();
  }
  const cleaned = without.replace(/(?:^|\s)site:[^\s]+/gi, ' ');
  const phraseTerms = phrases.flatMap((phrase) => tokenize(phrase));
  const allTokens = [...tokenize(cleaned), ...phraseTerms];
  const meaningful = allTokens.filter((token) => !STOP_WORDS.has(token));
  const tokens = meaningful.length ? meaningful : allTokens;
  const intent = /\b(how|what|why|tutorial|guide|learn|example)\b/i.test(raw)
    ? 'informational'
    : /\b(buy|price|cost|cheap|deal|shop|order)\b/i.test(raw)
      ? 'transactional'
      : /\b(login|sign in|official|website)\b/i.test(raw)
        ? 'navigational'
        : 'general';
  return {
    raw,
    terms: [...new Set(tokens)],
    phrases: [...new Set(phrases.filter(Boolean))],
    site,
    intent
  };
}
export function queryFeatures(q) {
  return {
    ...q,
    termCount: q.terms.length,
    phraseCount: q.phrases.length,
    complexity: clamp(q.terms.length + q.phrases.length * 2, 1, 20)
  };
}
