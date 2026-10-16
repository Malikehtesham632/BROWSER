# Nova Browser · Omni Engine

[![CI](https://github.com/Malikehtesham632/BROWSER/actions/workflows/ci.yml/badge.svg)](https://github.com/Malikehtesham632/BROWSER/actions/workflows/ci.yml)

Nova Browser is a Windows desktop browser with a Firefox-style interface. It is powered by **Omni Engine**, a search engine that mixes results from several web search providers with its own crawler and index, and includes a controlled AI Query Lab for generating test queries.

## Quick start

You need [Node.js 22](https://nodejs.org/) or newer.

```powershell
npm install
Copy-Item .env.example .env
npm run browser
```

Without any key the browser still searches through SearXNG (see the privacy note below). Add provider keys to `.env` for better results. Never commit `.env`.

| Command | What it does |
| --- | --- |
| `npm run browser` | Start the desktop browser |
| `npm start` | Start the search server and web page at `http://127.0.0.1:8787` |
| `npm test` | Run all tests |
| `npm run build:win` | Build the Windows installer into `release/` |
| `npm run format` | Format the code |

## Project layout

```text
desktop/     Electron app: main process, preload bridge, screens, bookmarks and history storage
src/         Omni Engine: search, providers, ranking, crawler, index, Query Lab, HTTP server
public/      Web page served by `npm start`
tests/       Automated tests (node:test, no extra packages)
benchmark/   Evaluation query sets
build/       Installer icons and artwork
installer/   NSIS installer script
```

## Privacy

1: **SearXNG.** When SearXNG is on, the text you search for is sent to the SearXNG servers it uses. If `SEARXNG_INSTANCES` is empty, Nova uses a few public servers run by third parties. To keep every search private, set `SEARXNG_ENABLED=false`, or list only your own server.
2: **Search providers.** Serper, SerpApi and Exa receive your search text when you add their keys.
3: **Bookmarks and history** stay on your computer, in `%APPDATA%\Nova Browser\library.json`.
4: **Keys** stay in the main process or in `.env`. They are never given to web pages or the interface, and the installer contains none.

## Architecture

```text
User Query
  -> Query Analyzer
  -> Omni Index + Discovery Providers (Serper, SerpApi, Exa, SearXNG)
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

Set `GEMINI_API_KEY` in `.env` to use the Query Lab and the "Explore a topic" card. The query model defaults to `gemini-3.5-flash`. Do not use `gemini-2.5-flash`: Google is shutting it down on 16 October 2026.

## Omni Desktop Browser Preview

Launch the Electron desktop browser from the project folder:

```powershell
npm run browser
```

The browser starts the existing Omni search engine in its main process, so provider keys remain out of the renderer. Web pages open in isolated browser views. Errors shown in the interface use calm, non-technical wording, while technical details stay out of the way.

### Firefox-style interface

1: Rounded tabs with site icons, a loading spinner, pinned tabs, a right-click tab menu (reload, pin, duplicate, close others), and Ctrl+Shift+T to reopen a closed tab.
2: One address bar with a lock icon, a bookmark star, and suggestions from your bookmarks, history and past searches. Typing words searches; typing an address opens it.
3: A bookmarks bar (Never, New tab only, or Always), plus Bookmarks (Ctrl+B) and History (Ctrl+H) sidebars with search. History is grouped by day and can be cleared.
4: A start page with a search box and Shortcuts tiles built from the sites you visit most.
5: A find bar at the bottom of the window (Ctrl+F) and a Firefox-style application menu with zoom, full screen, theme (Dark, Light or System), animation settings and the list of keyboard shortcuts.
6: Permission prompts: a page that wants your location, notifications, camera or microphone must ask, and you choose Allow or Block. Everything else is blocked.
7: After you open a result, Back returns to your saved search results without searching again.

Bookmarks, history and past searches are saved in `library.json` inside Nova's data folder (`%APPDATA%\Nova Browser`).

### Search animation

While a search runs, a radar shows every source reaching out. When a source answers it turns green and sends a data packet into the core, the page counter counts up, and the sites found slide in as chips. The four steps (contacting, reading, merging, ranking) and the progress bar follow the real answers from your providers, and the address bar shows a progress line. If a source fails it turns amber. Results then slide in one by one.

If Windows has **Show animations** turned off, Nova follows it and uses a calm version. Open the menu, choose **Animations**, then **On** to see the full animation anyway.

Omni queries every configured primary provider (Serper, SerpApi, and Exa) in parallel, merges and ranks their results, and uses configured SearXNG as a fallback when the primary providers return no results. A working search source and internet access are required for live web results; no search engine can promise results for literally every possible query. The menu displays configured sources, and failed providers do not prevent results from other healthy providers.

The home page can also use the Gemini query generator to suggest related searches. Enter a topic and choose **Generate ideas**; selecting a suggestion searches for it. The generator requires `GEMINI_API_KEY` and saves its cache and query corpus to Nova's per-user data folder.

In development, search and AI keys are loaded from the project's ignored `.env` file. The installer deliberately does not bundle API keys. For an installed copy, put a `.env` file in `%APPDATA%\Nova Browser` with the provider keys you want to use and restart Nova. Search needs at least one configured search provider (or a populated local index); AI suggestions additionally need `GEMINI_API_KEY`.

The desktop browser is a development build. It is not yet a signed installer and does not yet include a downloads panel, private windows, or tab drag-and-drop.

### Windows setup installer

Create the per-user Windows NSIS installer:

```powershell
npm run build:win
```

The installer is written to `release/Nova Browser-Setup-<version>.exe`. It offers an install-location page, optional Desktop and Start Menu shortcuts, a launch-on-finish checkbox, and a profile-removal checkbox during uninstall. Upgrades keep the Nova profile under the current user's application data; profile removal is an explicit uninstall choice. Build signing can be enabled through electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables; no signing certificate or search-provider secrets are bundled.

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

Open `http://127.0.0.1:8787` for the web page. The page is served with a strict content security policy, and only simple file types from `public/` are served (never hidden files or files outside that folder).

Search:

```text
GET /health
GET /search?q=python%20asyncio
GET /search/stream?q=python%20asyncio     (live progress, one event per provider)
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

The test suite has 217 tests. They cover the crawler, index and ranking, the search providers (including SearXNG), the AI client and query corpus, the HTTP server and web page serving, bookmarks, history and permissions, and the desktop main process (run against a fake Electron). The interface itself was checked in a headless browser. CI runs the tests on Windows and Linux for every push and pull request.

## Releasing

1: Change `version` in `package.json` and describe the change in `CHANGES.md`.
2: Commit, then tag it: `git tag v1.1.0` and `git push origin main --tags`.
3: The **Build Windows installer** workflow runs the tests, builds `Nova Browser-Setup-<version>.exe`, and attaches it to a GitHub release. Installers are never committed to the repository.

The installer is not code-signed yet, so Windows SmartScreen will warn. Add `CSC_LINK` and `CSC_KEY_PASSWORD` as repository secrets to sign it.

## Gemini Query Lab + Corpus Evaluation

Omni uses Gemini only for query classification and query expansion. It does not use Gemini as the crawler, search provider, index, or ranking authority. The Gemini API supports JSON output, which Omni uses for deterministic query-corpus ingestion.

Configure:

```env
GEMINI_API_KEY=your_key_here
GEMINI_QUERY_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-3.6-flash,gemini-3.7-flash
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_BASE_MS=1000
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

## Crawler behavior

```powershell
npm run crawl -- https://example.com
npm run crawl:recrawl
npm run crawl:frontier
```

1: robots.txt is parsed per website and cached for one hour. The most specific matching rule wins, and `Allow` wins a tie. A 4xx robots.txt means everything is allowed. A 5xx or network error means the site is treated as blocked for a few minutes.
2: The crawler waits `CRAWLER_DELAY_MS` between requests to the same website, or the site's `Crawl-delay` if that is larger (maximum 30 seconds).
3: A failed page is retried with growing waits (5 s, 10 s, 20 s ...) up to 3 attempts. A 404, a non-HTML page or a robots.txt block is not retried.
4: A page that was already crawled is only crawled again after its recrawl date (7 days by default). Starting a crawl with a seed URL forces that seed to be crawled again.
5: If a crawl stops in the middle, pages left in the `crawling` state are put back in the queue on the next start.

## Search text rules

The same tokenizer is used for the index, the query and the re-ranker. It lowercases text, keeps words from any language, keeps `c++` and `c#` as one word, drops trailing dots (so `asyncio.` matches `asyncio`) and also indexes the parts of words like `node.js` and `fastapi-users`. Matching is by whole word, so `api` does not match `rapid`. Chinese, Japanese and Thai text has no spaces between words, so it is not split into words yet.

## Ranking and evaluation

The re-ranker adds a small boost for trusted domains. It is controlled by `RANK_AUTHORITY_WEIGHT` (default `0.04`, use `0` to turn it off) and `RANK_QUALITY_DOMAINS`.

`benchmark/queries.json` counts a whole domain as relevant, and the default trusted list uses the same domains. Because of that, compare the two runs:

```powershell
npm run evaluate:quick
npm run evaluate:no-authority
npm run evaluate:judged
```

`evaluate:judged` uses `benchmark/judged.json`, where each exact URL has a grade from 0 to 3. These are starter judgments: check each URL and add more.

## Server safety

The server refuses to start when `HOST` is not local and `OMNI_API_TOKEN` is empty, because `/queries/generate`, `/queries/smart` and `/scrape` can spend paid API credits. Gemini requests send the key in the `x-goog-api-key` header, not in the URL. The default model is the stable `gemini-3.5-flash`; if you choose another model, `gemini-3.5-flash` is added as the last fallback.

## Code style

```powershell
npm run format
```

`tests/provider-test.js` is a manual tool that calls real providers with your API keys, so `npm test` does not run it. Use `npm run test:providers`.
