import {
  $,
  $$,
  activeTab,
  ctx,
  emit,
  on,
  mountIcons,
  preferences,
  reportUiError,
  savePreferences,
  setIcon,
  showToast
} from './shared.js';
import { addressUrl, clamp } from './ui-helpers.js';
import { fromKeyboardEvent, matchShortcut } from './shortcuts.js';
import { initTabs } from './tabs-ui.js';
import { focusAddress, initUrlbar } from './urlbar-ui.js';
import {
  closeMenu,
  initPanels,
  openFind,
  refreshMenuPreferences,
  setZoomLabel,
  toggleSidebar,
  updateBookmarksBar
} from './panels-ui.js';
import { focusHero, initNewTab } from './newtab-ui.js';
import {
  applyTab,
  canReturnToResults,
  initSearch,
  returnToResults,
  showLanding
} from './search-ui.js';

const PREFERENCE_CHOICES = {
  theme: ['dark', 'light', 'system'],
  bookmarksBar: ['never', 'newtab', 'always'],
  motion: ['auto', 'full', 'reduced']
};

const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const systemReduced = matchMedia('(prefers-reduced-motion: reduce)');

function applyTheme() {
  const choice = preferences().theme;
  root.dataset.theme =
    choice === 'system'
      ? systemDark.matches
        ? 'dark'
        : 'light'
      : choice === 'light'
        ? 'light'
        : 'dark';
}

function applyMotion() {
  const choice = preferences().motion;
  root.dataset.motion =
    choice === 'reduced' || (choice === 'auto' && systemReduced.matches) ? 'reduced' : 'full';
}

function applyPreferences() {
  applyTheme();
  applyMotion();
  updateBookmarksBar();
  refreshMenuPreferences();
}

let lastLayout = '';

function reportLayout() {
  const rect = $('#content').getBoundingClientRect();
  const insets = {
    top: Math.max(0, Math.round(rect.top)),
    left: Math.max(0, Math.round(rect.left)),
    right: Math.max(0, Math.round(innerWidth - rect.right)),
    bottom: Math.max(0, Math.round(innerHeight - rect.bottom))
  };
  const key = JSON.stringify(insets);
  if (key === lastLayout) return;
  lastLayout = key;
  ctx.api.setLayout(insets);
}

function scheduleLayout() {
  requestAnimationFrame(reportLayout);
}

let searching = 0;
let barPercent = 12;
let barTimer = null;

function showBar(mode, percent) {
  const bar = $('#load-bar');
  bar.hidden = false;
  bar.classList.toggle('indeterminate', mode === 'indeterminate');
  bar.classList.toggle('determinate', mode === 'determinate');
  $('#load-bar-fill').style.width = mode === 'determinate' ? `${clamp(percent, 0, 100)}%` : '';
}

function updateLoadBar() {
  clearTimeout(barTimer);
  const tab = activeTab();
  if (searching > 0 && tab?.isHome) showBar('determinate', barPercent);
  else if (tab?.loading) showBar('indeterminate');
  else $('#load-bar').hidden = true;
}

on('search:phase', ({ phase }) => {
  if (phase === 'start') {
    searching += 1;
    barPercent = 12;
    updateLoadBar();
    return;
  }
  searching = Math.max(0, searching - 1);
  if (searching === 0 && activeTab()?.isHome) {
    showBar('determinate', 100);
    barTimer = setTimeout(updateLoadBar, 400);
  } else {
    updateLoadBar();
  }
});

window.addEventListener('nova:search-progress', (event) => {
  barPercent = event.detail.percent;
  if (searching > 0 && activeTab()?.isHome) showBar('determinate', barPercent);
});

function updateNav(state) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  $('#back').disabled = !tab || !(tab.canGoBack || canReturnToResults(tab));
  $('#forward').disabled = !tab || !tab.canGoForward;
  const reload = $('#reload');
  const loading = Boolean(tab?.loading);
  reload.setAttribute('aria-label', loading ? 'Stop loading' : 'Reload');
  reload.title = loading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)';
  reload.dataset.mode = loading ? 'stop' : 'reload';
  setIcon(reload, loading ? 'close' : 'reload');
}

function renderState(state) {
  ctx.state = state;
  emit('state', state);
  applyTab(state);
  updateNav(state);
  updateLoadBar();
  scheduleLayout();
  const tab = activeTab();
  document.title = tab?.title && !tab.isHome ? `${tab.title} — Nova Browser` : 'Nova Browser';
}

async function navigateTo(url, newTab = false) {
  try {
    if (newTab) await ctx.api.newTab(url);
    else await ctx.api.navigate(url);
  } catch (error) {
    showToast(
      error?.message && /valid|address|http/i.test(error.message)
        ? error.message
        : reportUiError('navigate', error)
    );
  }
}

async function goBack() {
  const tab = activeTab();
  if (!tab) return;
  if (tab.canGoBack) await ctx.api.go('back');
  else if (canReturnToResults(tab)) await returnToResults(tab.id);
}

function pulseStar() {
  const star = $('#bookmark-star');
  star.classList.remove('pop');
  void star.offsetWidth;
  star.classList.add('pop');
  setTimeout(() => star.classList.remove('pop'), 450);
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab || tab.isHome || !tab.url) {
    showToast('Open a web page first, then bookmark it.');
    return;
  }
  const result = await ctx.api.toggleBookmark();
  if (result?.bookmarked) pulseStar();
  showToast(result?.bookmarked ? 'Bookmark added.' : 'Bookmark removed.');
}

async function zoom(action) {
  const tab = activeTab();
  if (!tab || tab.isHome) {
    showToast('Zoom works on web pages.');
    return;
  }
  const percent = await ctx.api.zoom(action);
  setZoomLabel(percent);
  showToast(`Zoom ${percent}%`);
}

async function runCommand(name) {
  const tabs = ctx.state.tabs;
  try {
    if (/^tab-[1-8]$/.test(name)) {
      const target = tabs[Number(name.slice(4)) - 1];
      if (target) await ctx.api.activateTab(target.id);
      return;
    }
    switch (name) {
      case 'focus-address':
        focusAddress();
        break;
      case 'focus-search':
        if (activeTab()?.isHome && !$('#home-view').classList.contains('search-mode')) focusHero();
        else focusAddress();
        break;
      case 'new-tab':
        await ctx.api.newTab();
        setTimeout(focusAddress, 40);
        break;
      case 'close-tab': {
        const tab = activeTab();
        if (tab) await ctx.api.closeTab(tab.id);
        break;
      }
      case 'reopen-tab':
        if (!(await ctx.api.reopenTab())) showToast('There is no closed tab to reopen.');
        break;
      case 'reload': {
        const tab = activeTab();
        if (tab && !tab.isHome) await ctx.api.reload();
        break;
      }
      case 'hard-reload': {
        const tab = activeTab();
        if (tab && !tab.isHome) await ctx.api.reload(true);
        break;
      }
      case 'find':
        openFind();
        break;
      case 'bookmark':
        await toggleBookmark();
        break;
      case 'bookmarks-sidebar':
        toggleSidebar('bookmarks');
        break;
      case 'history-sidebar':
        toggleSidebar('history');
        break;
      case 'toggle-bookmarks-bar':
        emit('pref', {
          key: 'bookmarksBar',
          value: preferences().bookmarksBar === 'never' ? 'always' : 'never'
        });
        break;
      case 'fullscreen':
        await ctx.api.toggleFullscreen();
        break;
      case 'back':
        await goBack();
        break;
      case 'forward':
        if (activeTab()?.canGoForward) await ctx.api.go('forward');
        break;
      case 'home': {
        const tab = activeTab();
        if (!tab) break;
        await ctx.api.home();
        showLanding(tab.id);
        break;
      }
      case 'next-tab':
        await ctx.api.cycleTab(1);
        break;
      case 'prev-tab':
        await ctx.api.cycleTab(-1);
        break;
      case 'last-tab': {
        const last = tabs[tabs.length - 1];
        if (last) await ctx.api.activateTab(last.id);
        break;
      }
      case 'zoom-in':
        await zoom('in');
        break;
      case 'zoom-out':
        await zoom('out');
        break;
      case 'zoom-reset':
        await zoom('reset');
        break;
      case 'about':
        showToast('Nova Browser — search powered by Omni Engine.');
        break;
      case 'exit':
        await ctx.api.exit();
        break;
      default:
        break;
    }
  } catch (error) {
    showToast(reportUiError(`command ${name}`, error));
  }
}

function initOnboarding() {
  const dialog = $('#first-run');
  if (preferences().completed || typeof dialog.showModal !== 'function') return;
  let choice = preferences().theme;
  const mark = () =>
    $$('.theme-choice').forEach((button) =>
      button.classList.toggle('selected', button.dataset.themeChoice === choice)
    );
  const finish = (save) => {
    savePreferences(save ? { theme: choice, completed: true } : { completed: true });
    applyPreferences();
    dialog.close();
  };
  $$('.theme-choice').forEach((button) =>
    button.addEventListener('click', () => {
      choice = button.dataset.themeChoice;
      savePreferences({ theme: choice });
      applyTheme();
      mark();
    })
  );
  $('#first-run-continue').addEventListener('click', () => finish(true));
  $('#first-run-skip').addEventListener('click', () => finish(false));
  dialog.addEventListener('cancel', () => savePreferences({ completed: true }));
  mark();
  dialog.showModal();
}

function wireGlobalEvents() {
  document.addEventListener(
    'keydown',
    (event) => {
      if ($('#first-run').open) return;
      const command = matchShortcut(fromKeyboardEvent(event));
      if (command) {
        event.preventDefault();
        runCommand(command);
        return;
      }
      if (
        event.key === 'Escape' &&
        activeTab()?.loading &&
        !event.target.closest?.('input, dialog')
      ) {
        ctx.api.reload().catch(() => {});
      }
    },
    true
  );
  on('command', runCommand);
  on('navigate:request', ({ url, newTab }) => navigateTo(url, newTab));
  on('address:submit', ({ value }) => {
    const url = addressUrl(value);
    if (url) navigateTo(url);
    else emit('search:submit', { query: value });
  });
  on('pref', ({ key, value }) => {
    if (!PREFERENCE_CHOICES[key]?.includes(value)) return;
    savePreferences({ [key]: value });
    applyPreferences();
  });
  systemDark.addEventListener('change', applyTheme);
  systemReduced.addEventListener('change', applyMotion);

  $('#back').addEventListener('click', () => runCommand('back'));
  $('#forward').addEventListener('click', () => runCommand('forward'));
  $('#home').addEventListener('click', () => runCommand('home'));
  $('#reload').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab || tab.isHome) return;
    ctx.api.reload().catch(() => {});
  });

  ctx.api.onState(renderState);
  ctx.api.onCommand?.((name) => runCommand(String(name)));
  ctx.api.onLibraryChanged?.((kind) => emit('library:changed', kind));
  ctx.api.onNavigationError?.((error) => {
    showToast(error?.message || 'We could not open that page.');
    const status = $('#home-status');
    if (status) status.textContent = error?.message || '';
  });
  ctx.api.onSnapshot?.((snapshot) => {
    const image = $('#snapshot');
    if (!snapshot?.dataUrl) {
      image.hidden = true;
      image.removeAttribute('src');
      return;
    }
    const rect = $('#content').getBoundingClientRect();
    image.style.width = `${rect.width}px`;
    image.style.height = `${rect.height}px`;
    image.src = snapshot.dataUrl;
    image.hidden = false;
  });
  $('#snapshot').addEventListener('pointerdown', () => {
    closeMenu();
    document.activeElement?.blur?.();
  });
  $('#content').addEventListener('pointerdown', () => {
    if (!$('#browser-menu').hidden) closeMenu();
  });

  const observer = new ResizeObserver(scheduleLayout);
  ['#chrome', '#content', '#sidebar', '#findbar'].forEach((selector) =>
    observer.observe($(selector))
  );
  window.addEventListener('resize', scheduleLayout);
}

async function start() {
  if (!ctx.api) {
    document.body.textContent =
      'Nova Browser could not connect to its engine. Please restart the app.';
    return;
  }
  ctx.prefs = preferences;
  applyPreferences();
  mountIcons();
  initTabs();
  initUrlbar();
  initPanels();
  initNewTab();
  initSearch();
  wireGlobalEvents();
  initOnboarding();
  try {
    ctx.searchStatus = await ctx.api.getSearchStatus();
  } catch {
    ctx.searchStatus = null;
  }
  try {
    renderState(await ctx.api.getState());
  } catch (error) {
    showToast(reportUiError('load browser state', error));
  }
  reportLayout();
}

start();
