# Changes made on top of Provider Layer v10.3

Everything Copilot added (desktop browser, installer, provider tests, hash and cache fixes) is kept.

## Fixed

1: Search words: one shared tokenizer for the index, the query and the re-ranker. `asyncio.` now matches `asyncio`, `c`, `c++` and `c#` are kept, other languages work, `node.js` also gives `node` and `js`, and `api` no longer matches `rapid`.
2: Index ranking: BM25 now uses counts for the whole index (it only used the matching pages before), word counts are saved per page so queries are fast, and updating a page no longer loops over every word.
3: Crawl queue: finished and failed pages are only queued again with `force` or `requeueDone`, successful crawls reset the attempt counter, and pages stuck in `crawling` are released after 10 minutes or at the next start.
4: robots.txt: a rule group that starts with an empty `Disallow:` no longer swallows the next group (Copilot's parser blocked sites like "allow everyone, block BadBot"). robots.txt is cached per site for one hour, Crawl-delay is honored, and a minimum delay (`CRAWLER_DELAY_MS`) is kept between requests to the same site.
5: Crawl errors: a 404, a non-HTML page and a robots.txt block are not retried. A store error no longer leaves a page stuck.
6: Ranking test: the trusted-domain boost dropped from 0.10 to 0.04 and is configurable (`RANK_AUTHORITY_WEIGHT`, `RANK_QUALITY_DOMAINS`). `npm run evaluate:no-authority` and `npm run evaluate:judged` (new `benchmark/judged.json`) give fair comparisons.
7: Config: empty or invalid numbers in `.env` fall back to defaults. Gemini key goes in the `x-goog-api-key` header, and `gemini-3.5-flash` was added as the last stable fallback.
8: Server: refuses to start on a public HOST without OMNI_API_TOKEN.
9: Small things: weak-category sort order, dead code, unused variables, `.gitignore`, README inconsistencies, `npm run format`.

## Still open

1: Crawler SSRF: redirects are followed without checking each hop, and a name like `127.0.0.1.nip.io` passes the public-address check.
2: The link graph is stored but not used in ranking.
3: The index is one JSON file in memory (fine for thousands of pages, not millions).
4: Desktop: web pages in tabs can request camera, microphone and location, because no permission handler is set.
5: `src/ai/openai.js` is not used anywhere.
