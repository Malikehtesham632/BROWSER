import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadEnvFile } from '../config.js';
import { DocumentStore } from '../index/store.js';
import { createSearchEngine } from '../search.js';
import { QueryCorpus } from '../queries/corpus.js';
import { evaluateQuery, aggregateMetrics } from './metrics.js';

async function mapLimit(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, runner));
  return out;
}

function retrievalHealth(results, query) {
  const urls = results.map(r => r.url).filter(Boolean);
  const unique = new Set(urls);
  const duplicates = urls.length - unique.size;
  const hosts = new Set(urls.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean));
  return {
    resultCount: results.length,
    uniqueResults: unique.size,
    duplicateRate: duplicates / Math.max(1, results.length),
    distinctHosts: hosts.size,
    hasResults: results.length > 0,
    topUrl: results[0]?.url || null,
    queryLength: query.length
  };
}

export async function runCorpusEvaluation({ corpusFile, config = loadConfig(), engine, limit = 10, concurrency = 4, fresh = true, maxQueries = null, category = null, intent = null, benchmarkFile = null } = {}) {
  const corpus = new QueryCorpus(corpusFile || config.ai.corpusFile);
  await corpus.init();
  let queries = corpus.list({ category, intent });
  if (maxQueries) queries = queries.slice(0, maxQueries);
  let benchmark = null;
  if (benchmarkFile) {
    try { benchmark = JSON.parse(await fs.readFile(benchmarkFile, 'utf8')); } catch { benchmark = null; }
  }
  const judgments = new Map((benchmark?.queries || []).map(q => [String(q.query).toLowerCase(), q]));

  let owned = false;
  if (!engine) {
    const store = new DocumentStore(config.indexFile);
    await store.init();
    engine = createSearchEngine(config, { store });
    owned = true;
  }

  const rows = await mapLimit(queries, concurrency, async q => {
    const started = Date.now();
    try {
      const out = await engine.search(q.query, { limit, fresh });
      const latencyMs = Date.now() - started;
      const judgment = judgments.get(q.query.toLowerCase());
      const health = retrievalHealth(out.results || [], q.query);
      const judged = judgment ? evaluateQuery(out.results, { ...judgment, category: q.category, intent: q.intent }, { k: limit, latencyMs }) : null;
      return { id: q.id, query: q.query, category: q.category, intent: q.intent, latencyMs, health, judged };
    } catch (e) {
      return { id: q.id, query: q.query, category: q.category, intent: q.intent, latencyMs: Date.now() - started, error: String(e?.message || e) };
    }
  });

  const good = rows.filter(r => !r.error);
  const judged = good.map(r => r.judged).filter(Boolean);
  const categorySummary = {};
  for (const row of good) {
    const c = row.category || 'uncategorized';
    (categorySummary[c] ??= { queries: 0, noResultRate: 0, averageLatencyMs: 0, duplicateRate: 0, judgedQueries: 0, precisionAtK: [], mrr: [], ndcg: [] });
    const s = categorySummary[c];
    s.queries++;
    s.noResultRate += row.health.hasResults ? 0 : 1;
    s.averageLatencyMs += row.latencyMs;
    s.duplicateRate += row.health.duplicateRate;
    if (row.judged) { s.judgedQueries++; s.precisionAtK.push(row.judged.precisionAtK); s.mrr.push(row.judged.mrr); s.ndcg.push(row.judged.ndcg); }
  }
  for (const s of Object.values(categorySummary)) {
    s.noResultRate /= s.queries; s.averageLatencyMs /= s.queries; s.duplicateRate /= s.queries;
    for (const k of ['precisionAtK','mrr','ndcg']) { const a=s[k]; s[k]=a.length?a.reduce((x,y)=>x+y,0)/a.length:null; }
  }

  const weakCategories = Object.entries(categorySummary)
    .map(([category, s]) => ({ category, noResultRate: s.noResultRate, averageLatencyMs: s.averageLatencyMs, duplicateRate: s.duplicateRate, precisionAtK: s.precisionAtK, ndcg: s.ndcg }))
    .sort((a,b) => (b.noResultRate - a.noResultRate) || ((b.ndcg ?? -1) - (a.ndcg ?? -1)) || (b.averageLatencyMs - a.averageLatencyMs));

  return {
    corpus: { file: corpusFile || config.ai.corpusFile, totalAvailable: corpus.stats().queries, selected: queries.length },
    summary: { queries: rows.length, failed: rows.length - good.length, noResultRate: good.filter(r => !r.health.hasResults).length / Math.max(1, good.length), averageLatencyMs: good.length ? good.reduce((s,r)=>s+r.latencyMs,0)/good.length : 0, duplicateRate: good.length ? good.reduce((s,r)=>s+r.health.duplicateRate,0)/good.length : 0, judgedQueries: judged.length, judgedMetrics: judged.length ? aggregateMetrics(judged) : null },
    categorySummary,
    weakCategories,
    queries: rows,
    generatedAt: new Date().toISOString(),
    engine: { providers: engine?.providerNames?.() || [], index: engine?.indexStats?.() || null }
  };
}

export async function writeCorpusReport(result, file='reports/omni-corpus-evaluation.json') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf8');
  return file;
}

if (process.argv[1]?.endsWith('corpus-runner.js')) {
  loadEnvFile();
  const config = loadConfig();
  const benchmarkFile = process.env.EVAL_CORPUS_JUDGMENTS || null;
  const result = await runCorpusEvaluation({
    config,
    limit: Number(process.env.EVAL_CORPUS_RESULT_LIMIT) || 10,
    concurrency: Number(process.env.EVAL_CONCURRENCY) || 4,
    fresh: !/^(0|false|no)$/i.test(process.env.EVAL_CORPUS_FRESH || 'true'),
    maxQueries: Number(process.env.EVAL_CORPUS_LIMIT) || null,
    category: process.env.EVAL_CATEGORY || null,
    intent: process.env.EVAL_INTENT || null,
    benchmarkFile
  });
  await writeCorpusReport(result);
  console.log('\nOmni Corpus Evaluation Lab');
  console.log(`Corpus: ${result.corpus.selected}/${result.corpus.totalAvailable} queries`);
  console.log(`Failed: ${result.summary.failed} | No-result: ${(result.summary.noResultRate*100).toFixed(2)}% | Avg latency: ${result.summary.averageLatencyMs.toFixed(0)}ms | Duplicates: ${(result.summary.duplicateRate*100).toFixed(2)}%`);
  console.log(`Judged queries: ${result.summary.judgedQueries}`);
  console.log('Weak categories:');
  for (const row of result.weakCategories.slice(0, 10)) console.log(`- ${row.category}: no-result ${(row.noResultRate*100).toFixed(1)}% | latency ${row.averageLatencyMs.toFixed(0)}ms | dup ${(row.duplicateRate*100).toFixed(1)}%${row.ndcg == null ? '' : ` | nDCG ${row.ndcg.toFixed(2)}`}`);
  console.log('Report: reports/omni-corpus-evaluation.json');
}
