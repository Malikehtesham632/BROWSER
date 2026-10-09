const tabsElement = document.querySelector('#tabs');
const address = document.querySelector('#address');
const homeSearch = document.querySelector('#hero-search');
const homeView = document.querySelector('#home-view');
const homeStatus = document.querySelector('#home-status');
const resultsSection = document.querySelector('#results-section');
const resultsList = document.querySelector('#results-list');
const resultsMessage = document.querySelector('#results-message');
const searchLoading = document.querySelector('#search-loading');
const searchSkeletons = document.querySelector('#search-skeletons');
const providerProgress = document.querySelector('#search-provider-progress');
const aiButton = document.querySelector('#ai-generate');
const aiStatus = document.querySelector('#ai-status');
const aiQueries = document.querySelector('#ai-queries');
const browserChrome = document.querySelector('.browser-chrome');
const menuToggle = document.querySelector('#browser-menu-toggle');
const browserMenu = document.querySelector('#browser-menu');
const findForm = document.querySelector('#menu-find-form');
const findInput = document.querySelector('#menu-find-query');
const toast = document.querySelector('#toast');
const firstRun = document.querySelector('#first-run');
let state = { activeTabId: null, tabs: [] };
let toastTimer;
let searchSequence = 0;
let draggedTabId = null;
const PREFERENCES_KEY = 'nova-browser-preferences';
const FRIENDLY_ERROR_MESSAGE = 'We hit a small snag. Please give us a moment, then try again.';

function reportUiError(context, error) {
  console.error(`[Nova Browser] ${context}`, error);
  return FRIENDLY_ERROR_MESSAGE;
}

function preferences() {
  try {
    return JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
  } catch {
    return {};
  }
}

function setTheme(theme) {
  const selected = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selected;
  const themeToggle = document.querySelector('#theme-toggle');
  themeToggle.setAttribute('aria-label', selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  themeToggle.title = selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  const themeMenuLabel = document.querySelector('#menu-theme-label');
  if (themeMenuLabel) themeMenuLabel.textContent = themeToggle.title;
  themeToggle.innerHTML = selected === 'dark'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>';
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    const active = button.dataset.themeChoice === selected;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function finishFirstRun() {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
    ...preferences(),
    theme: document.documentElement.dataset.theme || 'dark',
    completed: true
  }));
  firstRun.close();
}

setTheme(preferences().theme);
if (!preferences().completed) firstRun.showModal();
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
});
document.querySelector('#first-run-continue').addEventListener('click', finishFirstRun);
document.querySelector('#first-run-skip').addEventListener('click', finishFirstRun);

function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTabId);
}

function syncChromeHeight() {
  window.omni?.setChromeHeight(browserChrome.getBoundingClientRect().height);
}

function closeBrowserMenu({ restoreFocus = false } = {}) {
  browserMenu.hidden = true;
  browserChrome.classList.remove('menu-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open browser menu');
  document.querySelector('#menu-shortcuts').hidden = true;
  findForm.hidden = true;
  findInput.value = '';
  document.querySelector('#menu-find-count').textContent = '';
  window.omni?.stopFindInPage();
  syncChromeHeight();
  if (restoreFocus) menuToggle.focus();
}

async function refreshSearchStatus() {
  const summary = document.querySelector('#menu-search-status');
  const engineSummary = document.querySelector('#menu-engine-summary');
  const engineList = document.querySelector('#menu-engine-list');
  const indexStatus = document.querySelector('#menu-index-status');
  try {
    const status = await window.omni.getSearchStatus();
    engineList.replaceChildren();
    for (const provider of status.providers) {
      const badge = document.createElement('span');
      badge.className = 'engine-badge';
      badge.textContent = provider === 'serper'
        ? 'Google · Serper'
        : provider === 'serpapi'
          ? 'Google · SerpApi'
          : provider === 'searxng'
            ? 'SearXNG'
            : provider[0].toUpperCase() + provider.slice(1);
      engineList.append(badge);
    }
    const ready = status.providers.length > 0 || status.indexDocuments > 0;
    summary.textContent = ready
      ? `${status.providers.length} search source${status.providers.length === 1 ? '' : 's'} configured`
      : 'Search sources need setup';
    engineSummary.textContent = ready
      ? (status.providers.length ? `${status.providers.length} web source${status.providers.length === 1 ? '' : 's'}` : 'Omni local index')
      : 'Connect a search source to get started';
    indexStatus.textContent = status.indexDocuments
      ? `${status.indexDocuments.toLocaleString()} pages in your local index · AI ${status.aiConfigured ? 'ready' : 'not set up'}`
      : `AI ${status.aiConfigured ? 'ready' : 'not set up'} · ${ready ? 'Live web search configured' : 'Add search-provider keys to your .env file'}`;
  } catch (error) {
    const message = reportUiError('Could not load search status', error);
    summary.textContent = message;
    engineSummary.textContent = message;
  }
}

async function openBrowserMenu() {
  browserMenu.hidden = false;
  browserChrome.classList.add('menu-open');
  menuToggle.setAttribute('aria-expanded', 'true');
  menuToggle.setAttribute('aria-label', 'Close browser menu');
  syncChromeHeight();
  await refreshSearchStatus();
}

async function setPageZoom(action) {
  try {
    const percentage = await window.omni.zoom(action);
    document.querySelector('#zoom-reset').textContent = `${percentage}%`;
  } catch (error) {
    showToast(reportUiError('Could not change page zoom', error));
  }
}

function openFindInPage() {
  const isHome = activeTab()?.isHome;
  findInput.value = '';
  findForm.hidden = false;
  document.querySelector('#menu-shortcuts').hidden = true;
  document.querySelector('#menu-find-count').textContent = isHome ? 'Open a web page first' : '';
  syncChromeHeight();
  findInput.focus();
  findInput.select();
}

function renderTabs() {
  tabsElement.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement('div');
    button.className = `tab${tab.id === state.activeTabId ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.loading ? ' loading' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    button.setAttribute('aria-label', `${tab.title || 'New tab'}${tab.audible ? ', playing audio' : ''}${tab.pinned ? ', pinned' : ''}`);
    button.tabIndex = tab.id === state.activeTabId ? 0 : -1;
    button.title = `${tab.title || 'New tab'}${tab.audible ? (tab.muted ? ' · Audio muted' : ' · Playing audio') : ''}`;
    button.draggable = true;
    button.addEventListener('click', event => {
      if (event.button === 1) {
        event.preventDefault();
        window.omni.closeTab(tab.id);
        return;
      }
      if (!event.target.closest('.tab-close, .tab-audio')) window.omni.activateTab(tab.id);
    });
    button.addEventListener('auxclick', event => {
      if (event.button === 1) {
        event.preventDefault();
        window.omni.closeTab(tab.id);
      }
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.omni.activateTab(tab.id);
      }
    });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      showTabContextMenu(event.clientX, event.clientY, tab);
    });
    button.addEventListener('dragstart', event => {
      draggedTabId = tab.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tab.id);
    });
    button.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    button.addEventListener('drop', event => {
      event.preventDefault();
      const movingId = draggedTabId || event.dataTransfer.getData('text/plain');
      draggedTabId = null;
      if (movingId && movingId !== tab.id) {
        const index = state.tabs.findIndex(item => item.id === tab.id);
        window.omni.moveTab(movingId, index);
      }
    });
    button.addEventListener('dragend', () => { draggedTabId = null; });

    const favicon = document.createElement('span');
    favicon.className = `tab-favicon${tab.loading ? ' tab-loading' : ''}`;
    if (tab.favicon && !tab.loading) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = tab.favicon;
      image.addEventListener('error', () => {
        image.remove();
        favicon.textContent = (tab.title?.[0] || 'N').toUpperCase();
      }, { once: true });
      favicon.append(image);
    } else if (!tab.loading) {
      favicon.textContent = tab.isHome ? 'N' : (tab.title?.[0] || 'N').toUpperCase();
    }
    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'tab-pin';
      pin.textContent = '◆';
      pin.setAttribute('aria-label', 'Pinned');
      favicon.append(pin);
    }
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New tab';
    if (tab.audible) {
      const audio = document.createElement('button');
      audio.type = 'button';
      audio.className = 'tab-audio';
      audio.setAttribute('aria-label', tab.muted ? 'Unmute tab' : 'Mute tab');
      audio.title = audio.getAttribute('aria-label');
      audio.textContent = tab.muted ? '×' : '◖';
      audio.addEventListener('click', event => {
        event.stopPropagation();
        window.omni.muteTab(tab.id);
      });
      button.append(favicon, title, audio);
    } else {
      button.append(favicon, title);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
    close.textContent = '×';
    close.addEventListener('click', event => {
      event.stopPropagation();
      window.omni.closeTab(tab.id);
    });
    button.append(close);
    tabsElement.append(button);
  }
}

function showTabContextMenu(x, y, tab) {
  document.querySelector('#tab-context-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'tab-context-menu';
  menu.className = 'tab-context-menu';
  menu.setAttribute('role', 'menu');
  const actions = [
    ['New tab', () => window.omni.newTab()],
    ['Duplicate tab', () => window.omni.duplicateTab(tab.id)],
    [tab.pinned ? 'Unpin tab' : 'Pin tab', () => window.omni.pinTab(tab.id)],
    ...(tab.audible ? [[tab.muted ? 'Unmute tab' : 'Mute tab', () => window.omni.muteTab(tab.id)]] : []),
    ['Reopen closed tab', () => window.omni.reopenClosedTab()],
    ['Close tab', () => window.omni.closeTab(tab.id)]
  ];
  for (const [label, action] of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.addEventListener('click', () => {
      menu.remove();
      action();
    });
    menu.append(item);
  }
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  const dismiss = event => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
    }
  };
  const escape = event => {
    if (event.key === 'Escape') {
      menu.remove();
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape, true);
    }
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', escape, true);
}

function renderState(next) {
  const activeTabChanged = state.activeTabId !== next.activeTabId;
  state = next;
  renderTabs();
  const tab = activeTab();
  if (!tab) return;
  if (activeTabChanged && tab.isHome) {
    resultsSection.hidden = true;
    resultsList.replaceChildren();
    resultsMessage.hidden = true;
    homeView.classList.remove('search-mode');
    homeStatus.textContent = '';
  }
  address.value = tab.url || '';
  document.querySelector('#clear-address').hidden = !address.value;
  document.querySelector('#back').disabled = !tab.canGoBack;
  document.querySelector('#forward').disabled = !tab.canGoForward;
  document.querySelector('#reload').innerHTML = tab.loading
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.9 9a7.5 7.5 0 0 1 12.4-2.7L20 9M4 17v-5h5m-1.4 2.7A7.5 7.5 0 0 0 20 15"/></svg>';
  document.querySelector('#reload').title = tab.loading ? 'Stop loading' : 'Reload (Ctrl+R)';
  homeView.hidden = !tab.isHome;
  if (!tab.isHome) {
    homeView.classList.remove('search-mode');
    resultsSection.hidden = true;
  }
  syncChromeHeight();
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function addressUrl(value) {
  const input = value.trim();
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return null;
  if (/^(?:localhost|(?:\[[\da-f:]+\])|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w-]+\.)+[\w-]+)(?::\d+)?(?:[/?#]|$)/i.test(input)) {
    return `https://${input}`;
  }
  return null;
}

function resultCard(result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  card.tabIndex = 0;
  const domain = document.createElement('div');
  domain.className = 'result-domain';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'result-title';
  const snippet = document.createElement('p');
  snippet.className = 'result-snippet';
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  try {
    const url = new URL(result.url);
    domain.textContent = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    domain.textContent = result.url;
  }
  link.textContent = result.title || result.url;
  snippet.textContent = result.snippet || 'Open this result to explore the page.';
  meta.textContent = (result.sources || []).join(' · ') || 'Omni result';
  const open = () => window.omni.navigate(result.url).catch(error => showToast(reportUiError('Could not open a search result', error)));
  link.addEventListener('click', open);
  card.append(domain, link, snippet, meta);
  return card;
}

async function search(query) {
  const value = query.trim();
  if (!value) {
    showToast('Type something to search.');
    return;
  }
  if (value.length > 300) {
    showToast('Searches can be up to 300 characters.');
    return;
  }
  const sequence = ++searchSequence;
  homeView.hidden = false;
  homeView.classList.add('search-mode');
  resultsSection.hidden = false;
  resultsList.replaceChildren();
  resultsList.setAttribute('aria-busy', 'true');
  searchLoading.hidden = false;
  searchLoading.setAttribute('aria-busy', 'true');
  searchSkeletons.hidden = false;
  providerProgress.replaceChildren();
  document.querySelector('#search-loading-query').textContent = `Searching for “${value}” across connected sources`;
  resultsMessage.hidden = true;
  resultsMessage.textContent = '';
  document.querySelector('#results-title').textContent = `Results for “${value}”`;
  document.querySelector('#results-count').textContent = '';
  homeStatus.textContent = '';
  address.value = value;
  document.querySelector('#clear-address').hidden = false;
  try {
    const result = await window.omni.search(value, sequence);
    if (sequence !== searchSequence) return;
    searchLoading.hidden = true;
    searchLoading.setAttribute('aria-busy', 'false');
    searchSkeletons.hidden = true;
    resultsList.setAttribute('aria-busy', 'false');
    document.querySelector('#results-title').textContent = `Results for “${result.query}”`;
    const providers = Object.values(result.providers || {});
    const successfulProviders = providers.filter(provider => provider.ok).length;
    document.querySelector('#results-count').textContent = `${result.results.length} results · ${successfulProviders} sources · ${result.tookMs} ms`;
    resultsList.replaceChildren(...result.results.map(resultCard));
    const failedProviders = providers.filter(provider => !provider.ok && !provider.skipped);
    resultsMessage.hidden = result.results.length > 0;
    resultsMessage.textContent = result.results.length
      ? ''
      : failedProviders.length
        ? FRIENDLY_ERROR_MESSAGE
        : providers.length
          ? `No results for “${result.query}”. Try a different search.`
          : FRIENDLY_ERROR_MESSAGE;
  } catch (error) {
    if (sequence !== searchSequence) return;
    searchLoading.hidden = true;
    searchLoading.setAttribute('aria-busy', 'false');
    searchSkeletons.hidden = true;
    resultsList.setAttribute('aria-busy', 'false');
    resultsMessage.hidden = false;
    resultsMessage.textContent = reportUiError('Search request failed', error);
  }
}

function renderSearchProgress(progress) {
  if (progress.searchId !== searchSequence || searchLoading.hidden) return;
  if (progress.stage === 'start') {
    const labels = {
      serper: 'Google · Serper',
      serpapi: 'Google · SerpApi',
      exa: 'Exa',
      searxng: 'SearXNG'
    };
    for (const name of progress.providers) {
      const badge = document.createElement('span');
      badge.className = 'provider-progress pending';
      badge.dataset.provider = name;
      badge.dataset.label = labels[name] || name;
      badge.textContent = `${badge.dataset.label} · waiting`;
      providerProgress.append(badge);
    }
    if (progress.indexDocuments) {
      const badge = document.createElement('span');
      badge.className = 'provider-progress ready';
      badge.textContent = `Omni index · ${progress.indexDocuments} pages`;
      providerProgress.append(badge);
    }
    return;
  }
  if (progress.stage !== 'provider') return;
  const badge = providerProgress.querySelector(`[data-provider="${CSS.escape(progress.provider)}"]`);
  if (badge) {
    badge.className = `provider-progress ${progress.ok ? 'ready' : progress.skipped ? 'pending' : 'failed'}`;
    badge.textContent = progress.ok
      ? `${badge.dataset.label} · ${progress.resultCount} found`
      : progress.skipped
        ? `${badge.dataset.label} · waiting`
        : 'A source hit a small snag';
  }
  if (progress.results.length) {
    searchSkeletons.hidden = true;
    resultsList.replaceChildren(...progress.results.map(resultCard));
  }
}

async function generateQueries() {
  const query = (homeSearch.value.trim() || address.value.trim()).slice(0, 300);
  if (query.length < 2) {
    aiStatus.textContent = 'Enter a topic with at least two characters in the search box above.';
    homeSearch.focus();
    return;
  }
  if (!window.omni) {
    aiStatus.textContent = 'AI query generation is available in the Nova desktop app.';
    return;
  }
  aiButton.disabled = true;
  aiButton.classList.add('loading');
  aiQueries.hidden = true;
  aiQueries.replaceChildren();
  aiStatus.textContent = `Generating related search ideas for “${query}”…`;
  try {
    const result = await window.omni.generateQueries(query);
    const queries = result.queries || [];
    aiQueries.replaceChildren(...queries.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-query';
      button.textContent = item.query;
      button.title = `Search for: ${item.query}`;
      button.addEventListener('click', () => {
        homeSearch.value = item.query;
        search(item.query);
      });
      return button;
    }));
    aiQueries.hidden = queries.length === 0;
    aiStatus.textContent = result.aiUnavailable
      ? queries.length
        ? 'AI is taking a short break. Here are a few related ideas instead.'
        : FRIENDLY_ERROR_MESSAGE
      : queries.length
        ? `${queries.length} ideas · ${result.category || 'Topic'} · ${result.intent || 'Search'}`
        : 'The generator returned no ideas. Try a more specific topic.';
  } catch (error) {
    aiStatus.textContent = reportUiError('Could not generate search ideas', error);
  } finally {
    aiButton.disabled = false;
    aiButton.classList.remove('loading');
  }
}

function submitAddress(value) {
  const input = value.trim();
  if (!input) return;
  const url = addressUrl(input);
  if (url) {
    window.omni.navigate(url).catch(error => showToast(reportUiError('Could not open the requested page', error)));
  } else {
    search(input);
  }
}

document.querySelector('#address-form').addEventListener('submit', event => {
  event.preventDefault();
  submitAddress(address.value);
});
document.querySelector('#hero-form').addEventListener('submit', event => {
  event.preventDefault();
  submitAddress(homeSearch.value);
});
document.querySelector('#new-tab').addEventListener('click', () => window.omni.newTab());
menuToggle.addEventListener('click', () => {
  if (browserMenu.hidden) openBrowserMenu();
  else closeBrowserMenu();
});
document.querySelector('#menu-close').addEventListener('click', () => closeBrowserMenu({ restoreFocus: true }));
browserMenu.addEventListener('click', event => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  if (!action) return;
  switch (action) {
    case 'new-tab':
      closeBrowserMenu();
      window.omni.newTab();
      break;
    case 'close-tab':
      closeBrowserMenu();
      if (state.activeTabId) window.omni.closeTab(state.activeTabId);
      break;
    case 'reload':
      closeBrowserMenu();
      window.omni.reload();
      break;
    case 'home':
      closeBrowserMenu();
      document.querySelector('#home').click();
      break;
    case 'theme':
      document.querySelector('#theme-toggle').click();
      document.querySelector('#menu-theme-label').textContent = document.documentElement.dataset.theme === 'dark'
        ? 'Switch to light theme'
        : 'Switch to dark theme';
      break;
    case 'shortcuts': {
      const shortcuts = document.querySelector('#menu-shortcuts');
      shortcuts.hidden = !shortcuts.hidden;
      findForm.hidden = true;
      syncChromeHeight();
      break;
    }
    case 'about':
      showToast('Nova Browser · Search powered by Omni Engine.');
      break;
    case 'exit':
      closeBrowserMenu();
      window.omni.exit();
      break;
  }
});
document.addEventListener('pointerdown', event => {
  if (!browserMenu.hidden && !event.target.closest('#browser-menu, #browser-menu-toggle')) closeBrowserMenu();
});
document.querySelector('#menu-find-open').addEventListener('click', openFindInPage);
findForm.addEventListener('submit', event => {
  event.preventDefault();
  window.omni.findInPage(findInput.value);
});
let findTimer;
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  if (activeTab()?.isHome) {
    document.querySelector('#menu-find-count').textContent = 'Open a web page first';
    return;
  }
  document.querySelector('#menu-find-count').textContent = '';
  findTimer = setTimeout(() => window.omni.findInPage(findInput.value), 120);
});
document.querySelector('#menu-find-previous').addEventListener('click', () => {
  if (findInput.value && !activeTab()?.isHome) window.omni.findInPage(findInput.value, 'backward');
});
document.querySelector('#menu-find-next').addEventListener('click', () => {
  if (findInput.value && !activeTab()?.isHome) window.omni.findInPage(findInput.value);
});
document.querySelector('#menu-find-close').addEventListener('click', () => {
  window.omni.stopFindInPage();
  findForm.hidden = true;
  findInput.value = '';
  syncChromeHeight();
});
document.querySelector('#zoom-out').addEventListener('click', () => setPageZoom('out'));
document.querySelector('#zoom-in').addEventListener('click', () => setPageZoom('in'));
document.querySelector('#zoom-reset').addEventListener('click', () => setPageZoom('reset'));
document.querySelector('#fullscreen-toggle').addEventListener('click', () => {
  window.omni.toggleFullscreen();
  closeBrowserMenu();
});
document.querySelector('#back').addEventListener('click', () => window.omni.go('back'));
document.querySelector('#forward').addEventListener('click', () => window.omni.go('forward'));
document.querySelector('#reload').addEventListener('click', () => window.omni.reload());
document.querySelector('#home').addEventListener('click', () => {
  window.omni.home();
  resultsSection.hidden = true;
  resultsList.replaceChildren();
  resultsMessage.hidden = true;
  homeView.classList.remove('search-mode');
  homeStatus.textContent = '';
});
document.querySelector('#clear-address').addEventListener('click', () => {
  address.value = '';
document.querySelector('#clear-address').hidden = true;
address.focus();
});
address.addEventListener('input', () => {
document.querySelector('#clear-address').hidden = address.value.length === 0;
});
document.querySelector('#theme-toggle').addEventListener('click', () => {
const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
setTheme(nextTheme);
localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...preferences(), theme: nextTheme }));
});
aiButton.addEventListener('click', generateQueries);
document.querySelectorAll('[data-query]').forEach(button => {
button.addEventListener('click', () => {
  homeSearch.value = button.dataset.query;
  search(button.dataset.query);
});
});
if (window.omni) {
aiButton.disabled = false;
window.omni.onState(renderState);
window.omni.onSearchProgress(renderSearchProgress);
  window.omni.onNavigationError(() => {
    homeView.hidden = false;
    homeView.classList.remove('search-mode');
    resultsSection.hidden = true;
    homeStatus.textContent = FRIENDLY_ERROR_MESSAGE;
    showToast(FRIENDLY_ERROR_MESSAGE);
  });
window.omni.onFindResult(({ matches, activeMatchOrdinal }) => {
  document.querySelector('#menu-find-count').textContent = matches
    ? `${activeMatchOrdinal} / ${matches}`
    : 'No matches';
});
window.omni.onFocusAddress(() => {
  address.focus();
  address.select();
});
window.omni.onOpenFind(() => {
  if (browserMenu.hidden) openBrowserMenu();
  openFindInPage();
});
window.omni.getState().then(renderState).catch(error => showToast(reportUiError('Could not load browser state', error)));
} else {
  homeStatus.textContent = 'UI preview only — run npm run browser to enable search and browsing.';
  aiButton.disabled = true;
}
new ResizeObserver(syncChromeHeight).observe(browserChrome);
window.addEventListener('resize', syncChromeHeight);
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'l') {
    event.preventDefault();
    address.focus();
    address.select();
  } else if ((event.ctrlKey || event.metaKey) && key === 't') {
    event.preventDefault();
    if (event.shiftKey) window.omni.reopenClosedTab();
    else window.omni.newTab();
  } else if ((event.ctrlKey || event.metaKey) && key === 'w') {
    event.preventDefault();
    if (state.activeTabId) window.omni.closeTab(state.activeTabId);
  } else if ((event.ctrlKey || event.metaKey) && key === 'r') {
    event.preventDefault();
    window.omni.reload();
  } else if ((event.ctrlKey || event.metaKey) && key === 'f') {
    event.preventDefault();
    if (browserMenu.hidden) openBrowserMenu();
    openFindInPage();
  } else if ((event.ctrlKey || event.metaKey) && key === 'tab') {
    event.preventDefault();
    const currentIndex = state.tabs.findIndex(tab => tab.id === state.activeTabId);
    const offset = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + offset + state.tabs.length) % state.tabs.length;
    if (state.tabs[nextIndex]) window.omni.activateTab(state.tabs[nextIndex].id);
  } else if (event.key === 'Escape' && !browserMenu.hidden) {
    closeBrowserMenu({ restoreFocus: true });
  } else if (event.key === 'F11') {
    event.preventDefault();
    window.omni.toggleFullscreen();
  } else if (event.altKey && key === 'arrowleft') {
    event.preventDefault();
    window.omni.go('back');
  } else if (event.altKey && key === 'arrowright') {
    event.preventDefault();
    window.omni.go('forward');
  }
});
