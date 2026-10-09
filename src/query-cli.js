import { loadConfig, loadEnvFile } from './config.js';
import { createGeminiClient } from './ai/gemini.js';
import { AICache } from './ai/cache.js';
import { QueryCorpus } from './queries/corpus.js';
import { createQueryGenerator } from './queries/generator.js';
loadEnvFile();
const config = loadConfig();
const corpus = new QueryCorpus(config.ai.corpusFile); await corpus.init();
const cache = new AICache(config.ai.cacheFile, { ttlMs: config.ai.cacheTtlMs, maxEntries: config.ai.cacheMaxEntries }); await cache.init();
const gen = createQueryGenerator(createGeminiClient(config, { cache }), corpus);
const args = process.argv.slice(2); const command = args[0];
const flag = name => { const i=args.indexOf(name); return i>=0 ? args[i+1] : undefined; };
if (command === 'add') { const q=args.slice(1).join(' '); if(!q) throw new Error('Usage: npm run query:add -- "your query"'); await corpus.addMany([q], {source:'user'}); console.log(`Added. ${JSON.stringify(corpus.stats())}`); }
else if (command === 'expand') { const seed=flag('--seed')||args.slice(1).find(x=>!x.startsWith('--')); if(!seed) throw new Error('Usage: npm run query:expand -- --seed "topic" --count 25 --category programming'); const r=await gen.expand(seed,{count:flag('--count'),category:flag('--category')||'general',intent:flag('--intent')||'mixed'}); console.log(JSON.stringify(r,null,2)); }
else if (command === 'smart') { const q=flag('--query')||args.slice(1).find(x=>!x.startsWith('--')); if(!q) throw new Error('Usage: npm run query:smart -- --query "your query" --count 20'); console.log(JSON.stringify(await gen.classifyAndExpand(q,{count:flag('--count')}),null,2)); }
else if (command === 'stats') console.log(JSON.stringify(corpus.stats(),null,2));
else if (command === 'list') console.log(JSON.stringify(corpus.list({category:flag('--category'),intent:flag('--intent'),limit:Number(flag('--limit'))||100}),null,2));
else console.log('Commands: add, expand, smart, stats, list');
