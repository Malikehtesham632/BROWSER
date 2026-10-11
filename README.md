# Omni Engine v10

Omni Engine v9 builds on the v8 persistent crawler/index/search foundation and adds a controlled AI Query Lab.

## Architecture

```text
User Query
  -> Query Analyzer
  -> Omni Index + Discovery Providers
  -> Fusion
  -> Omni Re-ranker
  -> Final Results

Query Lab
  -> User Seed Query
  -> Gemini GenerateContent API
  -> Query Classification + Expansion
  -> Deduplicated Persistent Query Corpus
  -> Evaluation / Benchmark Workloads
```

Gemini is used **only for query classification, query expansion, and benchmark/query-corpus generation**. It is not used as Omni's search result provider, crawler, index, or ranking authority.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Set `GEMINI_API_KEY` in `.env`. Keep the key server-side and never commit `.env`.

The query model defaults to `gemini-3.8-flash`; override with `GEMINI_QUERY_MODEL` if desired.

### SearXNG search provider

SearXNG runs in parallel with configured Serper, SerpAPI, and Exa providers. Its results are normalized and pass through the same URL deduplication, weighted reciprocal-rank fusion, and reranking pipeline. Configure one or more instance base URLs; instances must allow the JSON API at `GET /search?q=...&format=json`.

```env
SEARXNG_ENABLED=true
SEARXNG_INSTANCES=["https://searxng.deggo.fyi/"]
SEARXNG_RETRIES=1
```

`SEARXNG_INSTANCES` also accepts comma-separated URLs. The legacy `SEARXNG_URL` setting remains supported when `SEARXNG_INSTANCES` is unset. An instance that blocks its JSON API is reported unhealthy; Nova does not scrape its HTML as a fallback. Provider failures do not prevent other providers from returning results. `/health` reports provider latency, failures, circuit state, and SearXNG per-instance health after searches.

## Query Lab

Add one query manually:

```powershell
npm run query:add -- "how to authenticate a FastAPI API with OAuth"
```

Generate related queries from one seed:

```powershell
npm run query:expand -- --seed "FastAPI authentication" --count 25 --category backend
```

Classify one query and generate variants:

```powershell
npm run query:smart -- --query "best way to deploy FastAPI with Docker" --count 20
```

Inspect corpus size:

```powershell
npm run query:stats
```

Batch-expand a seed file (one query per line or a JSON array):

```powershell
npm run query:batch -- --file seeds.txt --count 20 --max-calls 50 --category programming
```

The batch command is deliberately bounded by `--max-calls` so a large seed file cannot accidentally trigger an unbounded number of API calls.

List stored queries:

```powershell
npm run query:list -- --category backend --limit 100
```

## HTTP API

Start Omni:

```powershell
npm start
```

Query corpus:

```text
GET /queries/stats
GET /queries?category=backend&limit=100
GET /queries/generate?seed=FastAPI%20authentication&count=25&category=backend
GET /queries/smart?q=FastAPI%20authentication&count=20
```

These endpoints require `GEMINI_API_KEY` for generation and use the same server authentication/rate limiting as other protected API routes.

## Important scope

No system can enumerate literally every possible Internet query. The AI Query Lab instead expands seeds into broad, diverse long-tail variants across categories and stores them persistently. The corpus can grow incrementally as you add more seed queries.

For large-scale generation, use many seeds by category rather than asking one model call to invent the entire Internet at once. This reduces duplication and makes the corpus auditable.

## Verification

```powershell
npm test
```

The test suite covers the crawler/index/search foundation plus the AI client parser, persistent query corpus, and query generation layer using mocked Gemini responses.

## Gemini Query Lab + Corpus Evaluation

Omni uses Gemini only for query classification and query expansion. It does not use Gemini as the crawler, search provider, index, or ranking authority. The Gemini API supports JSON output, which Omni uses for deterministic query-corpus ingestion.

Configure:

```env
GEMINI_API_KEY=your_key_here
GEMINI_QUERY_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.6-flash
GEMINI_MAX_RETRIES=2
GEMINI_RETRY_BASE_MS=800
GEMINI_TIMEOUT_MS=30000
GEMINI_MAX_OUTPUT_TOKENS=4000
```

Generate queries:

```bash
npm run query:smart -- --query "Python FastAPI authentication" --count 50
npm run query:expand -- --seed "PostgreSQL indexing" --count 100 --category databases
npm run query:batch -- --file seeds.txt --count 50 --max-calls 50
```

Run the generated corpus through Omni:

```bash
npm run evaluate:corpus
```

Environment controls:

```env
EVAL_CONCURRENCY=4
EVAL_CORPUS_LIMIT=1000
EVAL_CORPUS_RESULT_LIMIT=10
EVAL_CORPUS_FRESH=true
EVAL_CORPUS_JUDGMENTS=benchmark/queries.json
```

Corpus evaluation measures retrieval health for generated queries even when no manual relevance judgment exists. It reports no-result rate, latency, duplicate rate, category-level health, and any available judged metrics. It does not pretend that an unjudged generated query has a valid precision/recall score.

### Batch query generation

Copy `seeds.example.txt` to `seeds.txt`, edit the seeds, then run:

```powershell
Copy-Item seeds.example.txt seeds.txt
npm run query:batch -- --file seeds.txt --count 50 --max-calls 50
```

Gemini 429/5xx/timeout/network failures use bounded exponential backoff with jitter, per-model circuit breakers, and the configured fallback model chain. Successful JSON responses are persisted in a local AI cache so repeated prompts do not consume another Gemini request. `query:smart` falls back to related queries already present in the Omni corpus when Gemini is temporarily unavailable. Batch generation persists progress in `data/query-batch-state.json` and automatically resumes unfinished/deferred seeds on the next run.

### Resilience controls

```env
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_BASE_MS=1000
GEMINI_MAX_RETRY_DELAY_MS=15000
GEMINI_BREAKER_THRESHOLD=3
GEMINI_BREAKER_COOLDOWN_MS=30000
GEMINI_CACHE_TTL_SECONDS=604800
GEMINI_CACHE_MAX_ENTRIES=2000
GEMINI_CACHE_FILE=data/gemini-query-cache.json
```

## Nova Browser UI

The UI is a Firefox-style browser shell served at `/` (vanilla HTML/CSS/JS, no build step, no frontend dependencies).

Run it:

```bash
npm start          # then open http://127.0.0.1:8787/
npm run browser    # desktop app (Electron)
```

The desktop app includes an integrated tab strip, address and navigation controls, a browser menu, light/dark appearance settings, and a startup option to restore the previous session. Tabs can be reordered by dragging, pinned, duplicated, muted, closed, and reopened; each tab has its own browsing history. Search results are opened in the active browser tab.

The browser menu includes zoom, find-in-page, fullscreen, provider availability, and settings. In the desktop app, API credentials for Serper, SerpApi, Exa, and Firecrawl can be saved from Settings and are encrypted using the operating system's secure storage; restart Nova to activate changed credentials. Firecrawl is used for page extraction, not search results. SearXNG instances continue to use the `.env` configuration. Keyboard shortcuts include `Ctrl+L` to focus the address bar, `Ctrl+T` to open a tab, `Ctrl+W` to close a tab, `Ctrl+Shift+T` to reopen the last closed tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` to switch tabs, `Ctrl+R` to reload or stop loading, `Ctrl+F` to find in page, `Alt+S` to open settings, `F11` for fullscreen, and `Alt+Left/Right` for back/forward.
