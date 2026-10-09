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

What's in it:
- Firefox-style tab strip merged into the title bar (desktop), toolbar and unified address bar
- Light and dark themes that follow the system, with a manual override in Settings
- Address-bar dropdown: search suggestion, bookmarks and history, with full keyboard navigation
- Independent tabs, each with its own back/forward history; going back or forward restores cached results instantly
- Results show the site, a breadcrumb path, highlighted query terms and which sources found each page
- Source chips double as filters; the sidebar shows live provider activity and query analysis
- Bookmarks (searches and individual pages), searchable history grouped by day, sidebar panel, Downloads placeholder
- Settings: theme, results per search, Omni Engine status, privacy controls, Nova updates
- Real-time `/search/stream` integration with a loading bar and per-tab spinner

Keyboard shortcuts: `Ctrl+L` address bar, `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+Tab` next tab, `Ctrl+1..9` jump to tab, `Ctrl+D` bookmark, `Ctrl+B` sidebar, `Ctrl+H` history, `Ctrl+Shift+O` bookmarks, `Ctrl+J` downloads, `Ctrl+,` settings, `Ctrl+R`/`F5` reload, `Alt+Left/Right` back/forward, `Esc` stop.

Result links currently open in a new window. Rendering pages inside tabs is the next step.
