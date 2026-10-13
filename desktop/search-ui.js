import { $, activeTab, ctx, el, emit, on, showToast, siteIcon, reportUiError } from './shared.js';
import { createSearchAnimation } from './search-animation.js';
import { displayUrl, formatSeconds, hostOf } from './ui-helpers.js';

const views = new Map();
let animation = null;
let searchCounter = 0;
let paintedTab = null;
let paintedRecord = null;
let renderedUrls = new Set();
let hintShown = false;

function webUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function messageFor(error) {
  const text = String(error?.message || '');
  if (/No search provider/i.test(text)) return text;
  if (/at most 300/i.test(text))
    return 'That search is too long. Please keep it under 300 characters.';
  return reportUiError('search', error);
}

function isActive(tabId) {
  return ctx.state.activeTabId === tabId;
}

function renderResults(record) {
  const list = $('#results-list');
  const cards = [];
  let order = 0;
  for (const result of record.results) {
    const url = webUrl(result.url);
    if (!url) continue;
    const host = hostOf(url);
    const fresh = !renderedUrls.has(url);
    renderedUrls.add(url);
    const title = el('button', {
      class: 'result-title',
      type: 'button',
      text: String(result.title || host || url).slice(0, 200)
    });
    title.addEventListener('click', (event) =>
      emit('navigate:request', { url, newTab: event.ctrlKey || event.metaKey })
    );
    title.addEventListener('auxclick', (event) => {
      if (event.button === 1) emit('navigate:request', { url, newTab: true });
    });
    const sources = (result.sources || []).join(' · ');
    const card = el(
      'article',
      { class: fresh ? 'result-card' : 'result-card static' },
      siteIcon({ host, title: host, variant: 'large' }),
      el(
        'div',
        { class: 'result-body' },
        el('div', { class: 'result-domain', text: displayUrl(url) }),
        title,
        el('p', {
          class: 'result-snippet',
          text: String(result.snippet || 'Open this result to explore the page.').slice(0, 400)
        }),
        sources ? el('div', { class: 'result-meta', text: sources }) : null
      )
    );
    card.style.setProperty('--i', String(Math.min(order++, 12)));
    cards.push(card);
  }
  list.replaceChildren(...cards);
  if (cards.length) $('#search-skeletons').hidden = true;
}

function setMessage(text) {
  const box = $('#results-message');
  box.textContent = text || '';
  box.hidden = !text;
}

function startAnimation(record) {
  const status = ctx.searchStatus || {};
  const providers = record.providers ?? status.providers ?? [];
  const indexDocuments = record.indexDocuments ?? status.indexDocuments ?? 0;
  record.started = { providers: [...providers], indexDocuments };
  animation.start({ query: record.query, providers, indexDocuments });
}

function paintLanding() {
  const view = $('#home-view');
  view.hidden = false;
  view.classList.remove('search-mode');
  $('#results-section').hidden = true;
  animation.cancel();
  emit('home:shown');
}

function paintSearch(record) {
  const view = $('#home-view');
  view.hidden = false;
  view.classList.add('search-mode');
  $('#results-section').hidden = false;
  $('#results-title').textContent = `Results for “${record.query}”`;
  $('#results-count').textContent = '';
  setMessage('');
  animation.cancel();
  renderedUrls = new Set(
    record.status === 'loading' ? [] : record.results.map((result) => webUrl(result.url))
  );
  renderResults(record);
  $('#search-skeletons').hidden = true;
  if (record.status === 'loading') {
    $('#search-skeletons').hidden = record.results.length > 0;
    startAnimation(record);
    for (const event of record.events) animation.provider(event);
  } else if (record.status === 'error') {
    setMessage(record.message);
  } else {
    finishPaint(record, { animate: false });
  }
}

function finishPaint(record, { animate }) {
  const total = record.results.length;
  $('#results-count').textContent = total
    ? `${total} result${total === 1 ? '' : 's'}${record.tookMs ? ` · ${formatSeconds(record.tookMs)}` : ''}`
    : '';
  setMessage(
    total
      ? ''
      : `No results for “${record.query}”. Try different words, or check your search sources in the menu.`
  );
  if (animate) animation.finish({ total, tookMs: record.tookMs });
}

function paint(tabId, { force = false } = {}) {
  const record = views.get(tabId) || null;
  if (!force && paintedTab === tabId && paintedRecord === record) {
    $('#home-view').hidden = false;
    return;
  }
  paintedTab = tabId;
  paintedRecord = record;
  if (record?.mode === 'search') paintSearch(record);
  else paintLanding();
}

export function applyTab(state) {
  const known = new Set(state.tabs.map((tab) => tab.id));
  for (const id of [...views.keys()]) {
    if (!known.has(id)) views.delete(id);
  }
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return;
  if (!tab.isHome) {
    $('#home-view').hidden = true;
    paintedTab = null;
    paintedRecord = null;
    return;
  }
  paint(tab.id);
}

export function canReturnToResults(tab) {
  const record = tab && views.get(tab.id);
  return Boolean(record && record.mode === 'search' && record.status !== 'loading' && !tab.isHome);
}

export async function returnToResults(tabId) {
  if (!views.get(tabId)) return;
  await ctx.api.home();
  paint(tabId, { force: true });
}

export function showLanding(tabId) {
  views.delete(tabId);
  emit('address:set', { tabId, value: '' });
  paint(tabId, { force: true });
}

export function lastQueryFor(tabId) {
  return views.get(tabId)?.query || '';
}

export async function submitSearch(rawQuery) {
  const tab = activeTab();
  const query = String(rawQuery ?? '').trim();
  if (!tab || !query) return;
  if (query.length > 300) {
    showToast('That search is too long. Please keep it under 300 characters.');
    return;
  }
  const searchId = ++searchCounter;
  const status = ctx.searchStatus;
  const record = {
    mode: 'search',
    query,
    status: 'loading',
    results: [],
    message: '',
    searchId,
    providers: status?.providers ?? null,
    indexDocuments: status?.indexDocuments ?? null,
    events: [],
    tookMs: 0
  };
  ctx.lastQuery = query;
  views.set(tab.id, record);
  emit('address:set', { tabId: tab.id, value: query });
  $('#hero-search').value = '';
  if (!tab.isHome) {
    try {
      await ctx.api.home();
    } catch (error) {
      showToast(reportUiError('go home before search', error));
    }
  }
  if (views.get(tab.id) !== record) return;
  paint(tab.id, { force: true });
  emit('search:phase', { phase: 'start' });
  const reduced = document.documentElement.dataset.motion === 'reduced';
  if (reduced && !hintShown && ctx.prefs?.().motion === 'auto') {
    hintShown = true;
    showToast('Animations are reduced by your system. Turn them on from the menu → Animations.');
  }
  try {
    const response = await ctx.api.search(query, searchId);
    if (views.get(tab.id) !== record) return;
    record.results = Array.isArray(response?.results) ? response.results : [];
    record.tookMs = Number(response?.tookMs) || 0;
    record.status = 'done';
    if (isActive(tab.id) && paintedRecord === record) {
      renderResults(record);
      finishPaint(record, { animate: true });
    }
  } catch (error) {
    if (views.get(tab.id) !== record) return;
    record.status = 'error';
    record.message = messageFor(error);
    if (isActive(tab.id) && paintedRecord === record) {
      animation.fail();
      $('#search-skeletons').hidden = true;
      setMessage(record.message);
    }
  } finally {
    emit('search:phase', { phase: 'end' });
  }
}

function handleProgress(progress) {
  const entry = [...views.entries()].find(([, record]) => record.searchId === progress?.searchId);
  if (!entry) return;
  const [tabId, record] = entry;
  if (record.status !== 'loading') return;
  if (progress.stage === 'start') {
    record.providers = progress.providers || [];
    record.indexDocuments = progress.indexDocuments || 0;
    if (isActive(tabId) && paintedRecord === record) {
      const same = JSON.stringify(record.started?.providers) === JSON.stringify(record.providers);
      if (!animation.isRunning() || !same) startAnimation(record);
    }
    return;
  }
  if (progress.stage !== 'provider') return;
  record.events.push(progress);
  if (Array.isArray(progress.results) && progress.results.length) record.results = progress.results;
  if (isActive(tabId) && paintedRecord === record) {
    animation.provider(progress);
    renderResults(record);
  }
}

export function initSearch() {
  animation = createSearchAnimation();
  ctx.api.onSearchProgress?.(handleProgress);
  on('search:submit', ({ query }) => submitSearch(query));
}
