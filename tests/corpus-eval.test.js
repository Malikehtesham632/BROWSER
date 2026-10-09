import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCorpusEvaluation } from '../src/eval/corpus-runner.js';
import { QueryCorpus } from '../src/queries/corpus.js';

test('weak categories list the worst category first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-corpus-eval-'));
  const corpusFile = path.join(dir, 'corpus.json');
  const benchmarkFile = path.join(dir, 'judgments.json');
  const corpus = new QueryCorpus(corpusFile);
  await corpus.init();
  await corpus.addMany([
    { query: 'good query', category: 'good-category' },
    { query: 'bad query', category: 'bad-category' }
  ]);
  await fs.writeFile(
    benchmarkFile,
    JSON.stringify({
      queries: [
        { query: 'good query', relevantDomains: ['good.example'] },
        { query: 'bad query', relevantDomains: ['good.example'] }
      ]
    })
  );
  const engine = {
    providerNames: () => [],
    indexStats: () => null,
    search: async (query) => ({
      results: [
        { url: query === 'good query' ? 'https://good.example/a' : 'https://other.example/a' }
      ]
    })
  };
  const report = await runCorpusEvaluation({
    corpusFile,
    benchmarkFile,
    engine,
    config: { ai: { corpusFile } },
    limit: 5
  });
  assert.equal(report.weakCategories[0].category, 'bad-category');
  assert.equal(report.weakCategories[1].category, 'good-category');
});
