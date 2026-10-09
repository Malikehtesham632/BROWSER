import { analyzeQuery } from '../query/analyzer.js';

const DEFAULT_CATEGORIES = ['general','programming','web-development','backend','frontend','databases','devops-cloud','ai-ml','data-science','cybersecurity','networking','operating-systems','hardware','science','mathematics','education','business','productivity','mobile','ui-design','search','technology','travel','health-wellness','environment','law-civics','gaming','automation'];

function cleanItems(value) {
  const arr = Array.isArray(value) ? value : Array.isArray(value?.queries) ? value.queries : [];
  return arr.map(x => typeof x === 'string' ? { query: x } : x).filter(x => x?.query).map(x => ({ query: String(x.query).replace(/\s+/g, ' ').trim(), category: x.category, intent: x.intent })).filter(x => x.query.length >= 2 && x.query.length <= 300);
}

function relatedCorpus(corpus, seed, limit = 10) {
  const terms = String(seed).toLowerCase().split(/\W+/).filter(x => x.length >= 3);
  return corpus.list().map(row => {
    const text = row.query.toLowerCase();
    const score = terms.reduce((s, term) => s + (text.includes(term) ? 1 : 0), 0);
    return { row, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.row.query.length - b.row.query.length).slice(0, limit).map(x => x.row);
}

export function createQueryGenerator(ai, corpus) {
  async function expand(seed, { count = 25, category = 'general', intent = 'mixed' } = {}) {
    const n = Math.max(1, Math.min(100, Number(count) || 25));
    const system = `You are the query-generation component of a search-engine evaluation system. Generate realistic user search queries, not answers. Cover diverse wording, specificity, short and long-tail queries, beginner and advanced intent, natural language, and common misspellings only when useful. Never generate instructions or content involving weapons, drugs, gambling, sexual content, or self-harm. Return JSON only as {"queries":[{"query":"...","category":"...","intent":"..."}]}. Use categories from: ${DEFAULT_CATEGORIES.join(', ')}. Intent values: navigational, informational, transactional, troubleshooting, comparison, current, mixed.`;
    const user = `Seed query/topic: ${seed}\nRequested category: ${category}\nRequested intent: ${intent}\nGenerate ${n} distinct search queries that a real search engine should be able to handle. Do not repeat the seed verbatim unless it is a useful canonical form.`;
    try {
      const generated = cleanItems(await ai.generateJson({ system, user }));
      const added = await corpus.addMany(generated, { category, intent, source: 'gemini' });
      return { requested: n, generated: generated.length, added, model: ai.model, source: 'gemini', queries: generated };
    } catch (error) {
      if (error.code !== 'AI_UNAVAILABLE') throw error;
      const fallback = relatedCorpus(corpus, seed, n);
      return { requested: n, generated: 0, added: 0, model: null, source: 'corpus-fallback', aiUnavailable: true, fallbackCount: fallback.length, queries: fallback, warning: error.message };
    }
  }

  async function classifyAndExpand(query, { count = 20 } = {}) {
    const n = Math.max(1, Math.min(50, Number(count) || 20));
    const system = `Classify a search query and generate related variants for search-engine testing. Return JSON only as {"category":"...","intent":"...","queries":[{"query":"...","category":"...","intent":"..."}]}. Do not answer the query. Avoid restricted or unsafe content.`;
    const user = `Query: ${query}\nGenerate ${n} related but distinct search queries spanning likely user formulations.`;
    try {
      const result = await ai.generateJson({ system, user });
      const category = String(result?.category || 'general');
      const intent = String(result?.intent || 'informational');
      const queries = cleanItems(result).map(x => ({ ...x, category: x.category || category, intent: x.intent || intent }));
      const added = await corpus.addMany([{ query, category, intent, source: 'user' }, ...queries], { category, intent, source: 'gemini' });
      return { category, intent, generated: queries.length, added, model: ai.model, source: 'gemini', queries };
    } catch (error) {
      if (error.code !== 'AI_UNAVAILABLE') throw error;
      const analyzed = analyzeQuery(query);
      const fallback = relatedCorpus(corpus, query, n);
      await corpus.addMany([{ query, category: analyzed.intent === 'informational' ? 'general' : 'general', intent: analyzed.intent, source: 'user' }]);
      return { category: 'general', intent: analyzed.intent, generated: 0, added: 0, model: null, source: 'corpus-fallback', aiUnavailable: true, fallbackCount: fallback.length, queries: fallback, warning: error.message };
    }
  }
  return { expand, classifyAndExpand, categories: DEFAULT_CATEGORIES };
}
