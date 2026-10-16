# Changelog

## 1.1.0

### Repository cleanup

1: Removed the five committed installer build folders (`installer-output-v1.0.4` to `v1.0.8`, about 600 MB). Installers belong on GitHub Releases, and `.gitignore` now blocks them.
2: Removed files that were committed by mistake: `data/` (crawl index and cached AI queries) and `reports/`. One report contained a Windows user name and folder path.
3: Removed dead files: the root `main.cjs` and `preload.cjs` (not used, and they required `electron-updater`, which is not installed), two unused stylesheets in `public/`, and `RELEASE-UPDATES.md` (described an updater that does not exist).
4: Fixed CI. The workflow ran `npm run dist`, which does not exist, and only ran on one old branch. There is now a test workflow for every push and pull request (Windows and Linux) and an installer workflow for version tags.
5: `npm test` was failing. Two test files described features that were not in the code (`browser.test.js`, `searxng.test.js`). The SearXNG work is now recovered and merged; the old desktop tests were moved out because their features are not in the current desktop code.
6: Set `engines` to Node 22 (the tests need it), added `.nvmrc`, repository links, `format:check`, and `.gitattributes` for consistent line endings.

### Fixes found during the review

1: **Gemini default model.** `gemini-2.5-flash` is shut down by Google on 16 October 2026. The default is now `gemini-3.5-flash`.
2: **Config bug.** A helper returned a plain string instead of a list when a setting was not set, so the trusted-domain ranking list was a string of letters and the boost silently did nothing. It is always a list now, and a test checks it.
3: **Timeouts.** The shared HTTP helper used a timer that does not keep Node alive, so a stalled connection could end a script silently. It now uses a normal timer that is cleaned up afterwards.
4: **Loopback check.** A host like `127.evil.com` was treated as local. The stricter check from the SearXNG work is used.
5: **Web page.** `npm start` was meant to serve the page in `public/`, but the code for it was missing. It is back, with a safe file server: only simple file types, no hidden files, no path tricks, and a content security policy.
6: **SearXNG.** Recovered the multi-instance provider: several servers, a shared time limit, retries, health tracking, and weighted fusion with the other providers. It is on by default; see the privacy note in the README.
7: `.env.example` pointed SearXNG at a local server that is usually not running. It now explains the choices and the privacy trade-off.

### Nova Browser (desktop)

1: Firefox-style interface: tabs with site icons, pinned tabs and a right-click menu; one address bar with a lock icon, a bookmark star and suggestions; a bookmarks bar; Bookmarks and History sidebars; a bottom find bar; an application menu; Shortcuts tiles; Dark, Light and System themes.
2: New search animation: a radar with one node per source, data packets, a live page counter, domain chips, four real steps and a progress bar.
3: Bookmarks, history, top sites and past searches, saved safely in `library.json` (a damaged file is set aside so the browser still starts).
4: Permission prompts for location, notifications, camera and microphone. Everything else is blocked.
5: Pages cannot be redirected to non-web addresses. Menus float over the page instead of pushing it down.
6: Back returns to your saved search results without searching again.
7: Fixed: with many tabs the tab strip grew past the window; the first letter was lost when typing right after clicking the address bar; the `activate` handler could register the message handlers twice.

### Search engine

1: One shared tokenizer for the index, the query and the re-ranker (`asyncio.` matches `asyncio`; `c`, `c++` and `c#` are kept; other languages work).
2: BM25 uses counts from the whole index; the crawler respects robots.txt groups, `Crawl-delay`, retry times and a per-site delay; the trusted-domain boost is small and configurable.

## Known gaps

1: The desktop app has no downloads panel, private windows, tab drag-and-drop, session restore, settings page for API keys, or auto-update. Some of these were in the older v1.0.4 to v1.0.8 builds.
2: The crawler does not check each redirect or look up DNS, so a name like `127.0.0.1.nip.io` passes the public-address check.
3: The link graph is stored but not used in ranking. `src/ai/openai.js` is not used.
4: The installer is not code-signed.
5: There is no `LICENSE` file. Until you add one, nobody else may legally reuse the code.
