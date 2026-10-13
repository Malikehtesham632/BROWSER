import { tokenSet } from '../core/tokenize.js';

const K1 = 1.2;
const B = 0.75;
const TITLE_TERM_BONUS = 0.7;
const PHRASE_BONUS = 2.5;
const MS_PER_DAY = 86400000;

function bm25Score(store, doc, terms, averageLength) {
  const total = Math.max(1, store.documentCount());
  const length = store.lengthOf(doc) || 1;
  const lengthRatio = length / Math.max(averageLength, 1);
  let score = 0;
  for (const term of terms) {
    const frequency = store.termFrequency(doc, term);
    if (!frequency) continue;
    const matching = store.documentFrequency(term);
    const idf = Math.log(1 + (total - matching + 0.5) / (matching + 0.5));
    score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * lengthRatio)));
  }
  return score;
}

function containsPhrase(doc, phrase) {
  const text = `${doc.title} ${doc.description} ${doc.content}`.toLowerCase();
  return text.includes(phrase.toLowerCase());
}

export function rankIndexed(store, query, { limit = 20 } = {}) {
  const terms = query.terms || [];
  const phrases = query.phrases || [];
  const candidates = store.candidates(terms);
  const averageLength = store.averageLength();
  const now = Date.now();
  const ranked = [];
  for (const doc of candidates) {
    let score = bm25Score(store, doc, terms, averageLength);
    if (!score) continue;
    const titleTokens = tokenSet(doc.title);
    for (const term of terms) if (titleTokens.has(term)) score += TITLE_TERM_BONUS;
    for (const phrase of phrases) if (containsPhrase(doc, phrase)) score += PHRASE_BONUS;
    const indexedAt = Date.parse(doc.indexedAt);
    const ageDays = Number.isFinite(indexedAt) ? Math.max(0, (now - indexedAt) / MS_PER_DAY) : 0;
    score *= 1 / (1 + ageDays / 3650);
    const shortPenalty = doc.wordCount < 80 ? 0.7 : 1;
    const longPenalty = doc.wordCount > 100000 ? 0.8 : 1;
    score *= shortPenalty * longPenalty;
    ranked.push({ ...doc, score });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
