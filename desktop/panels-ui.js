import {
  $,
  $$,
  activeTab,
  closeOverlay,
  ctx,
  el,
  emit,
  icon,
  mountIcons,
  on,
  openOverlay,
  preferences,
  setIcon,
  showToast,
  siteIcon
} from './shared.js';
import { displayUrl, groupHistory, providerLabel } from './ui-helpers.js';
import { SHORTCUT_HELP } from './shortcuts.js';

let bookmarks = [];
let sidebarPanel = null;
let lastPanel = 'bookmarks';
let sidebarTimer = null;
let clearArmed = null;
let menuOpen = false;
let findOpen = false;

export function getBookmarks() {
  return bookmarks;
}

function openUrl(url, event) {
  emit('navigate:request', {
    url,
    newTab: Boolean(event?.ctrlKey || event?.metaKey || event?.button === 1)
  });
}

async function loadBookmarks() {
  try {
    bookmarks = (await ctx.api.bookmarks()) || [];
  } catch {
    bookmarks = [];
  }
  renderBookmarksBar();
  if (sidebarPanel === 'bookmarks') renderSidebar();
}

function renderBookmarksBar() {
  const items = $('#bookmarks-items');
  items.replaceChildren();
  if (!bookmarks.length) {
    items.append(
      el('span', {
        class: 'bookmarks-empty',
        text: 'Bookmarks you add will appear here. Press Ctrl+D on any page.'
      })
    );
  }
  for (const bookmark of bookmarks) {
    const chip = el(
      'button',
      { class: 'bookmark-chip', type: 'button', title: `${bookmark.title}\n${bookmark.url}` },
      siteIcon({ url: bookmark.url, icon: bookmark.icon, title: bookmark.title }),
      el('span', { class: 'label', text: bookmark.title })
    );
    chip.addEventListener('click', (event) => openUrl(bookmark.url, event));
    chip.addEventListener('auxclick', (event) => {
      if (event.button === 1) openUrl(bookmark.url, event);
    });
    items.append(chip);
  }
  requestAnimationFrame(() => {
    $('#bookmarks-more').hidden = items.scrollWidth <= items.clientWidth + 1;
  });
}

export function updateBookmarksBar() {
  const mode = preferences().bookmarksBar;
  const tab = activeTab();
  const visible = mode === 'always' || (mode === 'newtab' && Boolean(tab?.isHome));
  $('#bookmarks-bar').hidden = !visible;
}

function sideItem({ title, sub, url, icon: iconUrl, onRemove, index }) {
  const main = el(
    'button',
    { class: 'side-main', type: 'button', title: url },
    siteIcon({ url, icon: iconUrl, title, variant: 'large' }),
    el(
      'span',
      { class: 'side-copy' },
      el('span', { class: 'side-title', text: title }),
      el('span', { class: 'side-sub', text: sub })
    )
  );
  main.addEventListener('click', (event) => openUrl(url, event));
  main.addEventListener('auxclick', (event) => {
    if (event.button === 1) openUrl(url, event);
  });
  const remove = el(
    'button',
    { class: 'side-remove', type: 'button', 'aria-label': `Remove ${title}`, title: 'Remove' },
    icon('close')
  );
  remove.addEventListener('click', onRemove);
  const row = el('div', { class: 'side-item', role: 'listitem' }, main, remove);
  row.style.animationDelay = `${Math.min(index, 14) * 18}ms`;
  return row;
}

async function renderSidebar() {
  const list = $('#sidebar-list');
  const query = $('#sidebar-query').value.trim().toLowerCase();
  if (sidebarPanel === 'bookmarks') {
    const items = bookmarks.filter(
      (item) => !query || `${item.title} ${item.url}`.toLowerCase().includes(query)
    );
    if (!items.length) {
      list.replaceChildren(
        el('p', {
          class: 'side-empty',
          text: query
            ? 'No bookmarks match your search.'
            : 'No bookmarks yet. Press Ctrl+D on a page, or click the star in the address bar.'
        })
      );
      return;
    }
    list.replaceChildren(
      ...items.map((item, index) =>
        sideItem({
          title: item.title,
          sub: displayUrl(item.url),
          url: item.url,
          icon: item.icon,
          index,
          onRemove: () => ctx.api.removeBookmark(item.id).catch(() => {})
        })
      )
    );
    return;
  }
  let entries = [];
  try {
    entries = (await ctx.api.history({ query, limit: 200 })) || [];
  } catch {
    entries = [];
  }
  if (sidebarPanel !== 'history') return;
  $('#history-clear').disabled = !entries.length && !query;
  if (!entries.length) {
    list.replaceChildren(
      el('p', {
        class: 'side-empty',
        text: query ? 'No pages match your search.' : 'Pages you visit will show up here.'
      })
    );
    return;
  }
  const nodes = [];
  let index = 0;
  for (const group of groupHistory(entries)) {
    nodes.push(el('div', { class: 'side-group', text: group.label }));
    for (const entry of group.items) {
      nodes.push(
        sideItem({
          title: entry.title,
          sub: displayUrl(entry.url),
          url: entry.url,
          icon: entry.icon,
          index: index++,
          onRemove: () => ctx.api.removeHistory(entry.url).catch(() => {})
        })
      );
    }
  }
  list.replaceChildren(...nodes);
}

export function openSidebar(panelName) {
  sidebarPanel = panelName;
  lastPanel = panelName;
  const isBookmarks = panelName === 'bookmarks';
  $('#sidebar').hidden = false;
  $('#sidebar-title').textContent = isBookmarks ? 'Bookmarks' : 'History';
  $('#sidebar-query').placeholder = isBookmarks ? 'Search bookmarks' : 'Search history';
  $('#sidebar-query').value = '';
  $('#sidebar-footer').hidden = isBookmarks;
  $$('.sidebar-tab').forEach((tab) =>
    tab.setAttribute('aria-selected', String(tab.dataset.panel === panelName))
  );
  $('#sidebar-toggle').setAttribute('aria-pressed', 'true');
  resetClearButton();
  renderSidebar();
  $('#sidebar-query').focus();
}

export function closeSidebar() {
  sidebarPanel = null;
  $('#sidebar').hidden = true;
  $('#sidebar-toggle').setAttribute('aria-pressed', 'false');
}

export function toggleSidebar(panelName = lastPanel) {
  if (sidebarPanel === panelName) closeSidebar();
  else openSidebar(panelName);
}

function resetClearButton() {
  clearTimeout(clearArmed);
  clearArmed = null;
  $('#history-clear').textContent = 'Clear all history';
}

function initSidebar() {
  setIcon($('#sidebar-tab-bookmarks'), 'bookmark');
  setIcon($('#sidebar-tab-history'), 'clock');
  setIcon($('#sidebar-close'), 'close');
  setIcon($('#sidebar-search-icon'), 'search');
  $('#sidebar-tab-bookmarks').title = 'Bookmarks (Ctrl+B)';
  $('#sidebar-tab-history').title = 'History (Ctrl+H)';
  $$('.sidebar-tab').forEach((tab) =>
    tab.addEventListener('click', () => openSidebar(tab.dataset.panel))
  );
  $('#sidebar-close').addEventListener('click', closeSidebar);
  $('#sidebar-toggle').addEventListener('click', () => toggleSidebar());
  $('#bookmarks-more').append(icon('more'));
  $('#bookmarks-more').addEventListener('click', () => openSidebar('bookmarks'));
  $('#sidebar-query').addEventListener('input', () => {
    clearTimeout(sidebarTimer);
    sidebarTimer = setTimeout(renderSidebar, 80);
  });
  $('#sidebar-query').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });
  $('#history-clear').addEventListener('click', async () => {
    if (!clearArmed) {
      $('#history-clear').textContent = 'Click again to confirm';
      clearArmed = setTimeout(resetClearButton, 3500);
      return;
    }
    resetClearButton();
    try {
      await ctx.api.clearHistory();
      showToast('History cleared.');
    } catch {
      showToast('We could not clear history. Please try again.');
    }
  });
  on('library:changed', (kind) => {
    if (kind === 'bookmarks' || kind === 'all') loadBookmarks();
    if ((kind === 'history' || kind === 'all') && sidebarPanel === 'history') {
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(renderSidebar, 250);
    }
  });
}

export function setZoomLabel(percent) {
  $('#zoom-reset').textContent = `${Math.round(Number(percent) || 100)}%`;
}

export function refreshMenuPreferences() {
  const prefs = preferences();
  $$('.segmented button').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(prefs[button.dataset.pref] === button.dataset.value)
    );
  });
}

async function refreshMenuStatus() {
  try {
    const status = await ctx.api.getSearchStatus();
    ctx.searchStatus = status;
    const names = status.providers || [];
    $('#menu-search-status').textContent = names.length
      ? `${names.length} search source${names.length === 1 ? '' : 's'} connected`
      : 'No search sources connected yet';
    $('#menu-engine-summary').textContent = names.length
      ? 'Search sources'
      : 'Add a search key to get started';
    $('#menu-engine-list').replaceChildren(
      ...names.map((name) => el('span', { class: 'engine-badge', text: providerLabel(name) }))
    );
    $('#menu-index-status').textContent = status.indexDocuments
      ? `${status.indexDocuments} pages in your local index`
      : 'Local index is empty. Crawl some pages to fill it.';
  } catch {
    $('#menu-search-status').textContent = 'Search status unavailable';
  }
  try {
    setZoomLabel(await ctx.api.zoom('get'));
  } catch {
    setZoomLabel(100);
  }
}

export function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  const menu = $('#browser-menu');
  const bottom = $('.toolbar').getBoundingClientRect().bottom;
  menu.style.setProperty('--menu-top', `${Math.round(bottom + 4)}px`);
  menu.hidden = false;
  $('#browser-menu-toggle').setAttribute('aria-expanded', 'true');
  openOverlay('menu');
  refreshMenuPreferences();
  refreshMenuStatus();
}

export function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  $('#browser-menu').hidden = true;
  $('#browser-menu-toggle').setAttribute('aria-expanded', 'false');
  closeOverlay('menu');
}

export function toggleMenu() {
  if (menuOpen) closeMenu();
  else openMenu();
}

export function menuIsOpen() {
  return menuOpen;
}

function initMenu() {
  mountIcons($('#browser-menu'));
  setIcon($('#fullscreen-toggle'), 'fullscreen');
  $('#browser-menu-toggle').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  $('#browser-menu').addEventListener('click', (event) => {
    const item = event.target.closest('[data-menu-action]');
    if (item) {
      const action = item.dataset.menuAction;
      if (action === 'shortcuts') {
        const box = $('#menu-shortcuts');
        box.hidden = !box.hidden;
        return;
      }
      closeMenu();
      emit('command', action);
      return;
    }
    const pref = event.target.closest('[data-pref]');
    if (pref) {
      emit('pref', { key: pref.dataset.pref, value: pref.dataset.value });
      refreshMenuPreferences();
    }
  });
  $('#zoom-in').addEventListener('click', () => emit('command', 'zoom-in'));
  $('#zoom-out').addEventListener('click', () => emit('command', 'zoom-out'));
  $('#zoom-reset').addEventListener('click', () => emit('command', 'zoom-reset'));
  $('#fullscreen-toggle').addEventListener('click', () => emit('command', 'fullscreen'));
  $('#menu-shortcuts').replaceChildren(
    ...SHORTCUT_HELP.map(([name, keys]) =>
      el('p', {}, el('span', { text: name }), el('kbd', { text: keys }))
    )
  );
  document.addEventListener('pointerdown', (event) => {
    if (!menuOpen) return;
    if (event.target.closest('#browser-menu') || event.target.closest('#browser-menu-toggle'))
      return;
    closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault();
      closeMenu();
      $('#browser-menu-toggle').focus();
    }
  });
}

export function openFind() {
  const tab = activeTab();
  findOpen = true;
  $('#findbar').hidden = false;
  const input = $('#find-query');
  input.focus();
  input.select();
  if (!tab || tab.isHome) $('#find-count').textContent = 'Open a page first';
}

export function closeFind() {
  if (!findOpen) return;
  findOpen = false;
  $('#findbar').hidden = true;
  $('#find-count').textContent = '';
  ctx.api.stopFindInPage?.()?.catch?.(() => {});
}

function runFind(forward = true, findNext = false) {
  const text = $('#find-query').value;
  const tab = activeTab();
  if (!text || !tab || tab.isHome) {
    $('#find-count').textContent = !text ? '' : 'Open a page first';
    if (!text) ctx.api.stopFindInPage?.()?.catch?.(() => {});
    return;
  }
  ctx.api.findInPage(text, { forward, findNext }).catch(() => {});
}

function initFind() {
  setIcon($('#find-icon'), 'search');
  setIcon($('#find-previous'), 'up');
  setIcon($('#find-next'), 'down');
  setIcon($('#find-close'), 'close');
  let timer;
  $('#find-query').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runFind(true, false), 120);
  });
  $('#find-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runFind(!event.submitter?.dataset.back, true);
  });
  $('#find-query').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      runFind(false, true);
    }
  });
  $('#find-next').addEventListener('click', () => runFind(true, true));
  $('#find-previous').addEventListener('click', () => runFind(false, true));
  $('#find-close').addEventListener('click', closeFind);
  ctx.api.onFindResult?.((result) => {
    if (!findOpen) return;
    const total = Number(result?.matches) || 0;
    $('#find-count').textContent = total
      ? `${result.activeMatchOrdinal || 0} of ${total}`
      : 'Phrase not found';
  });
}

const PERMISSION_ICONS = { geolocation: 'location', notifications: 'bell', media: 'camera' };

function addPermissionBar(request) {
  const bar = el(
    'div',
    { class: 'infobar', role: 'alert', dataset: { id: request.id } },
    el('span', { class: 'infobar-icon' }, icon(PERMISSION_ICONS[request.permission] || 'info')),
    el(
      'div',
      { class: 'infobar-text' },
      el('strong', { text: request.host }),
      document.createTextNode(` wants to ${request.action}.`)
    ),
    el('div', { class: 'infobar-actions' })
  );
  const answer = (allow) => {
    ctx.api.respondPermission(request.id, allow).catch(() => {});
    bar.remove();
  };
  const block = el('button', { class: 'pill-button', type: 'button', text: 'Block' });
  const allow = el('button', { class: 'pill-button primary', type: 'button', text: 'Allow' });
  block.addEventListener('click', () => answer(false));
  allow.addEventListener('click', () => answer(true));
  $('.infobar-actions', bar).append(block, allow);
  $('#infobars').append(bar);
  setTimeout(() => bar.remove(), 61000);
}

export function initPanels() {
  initSidebar();
  initMenu();
  initFind();
  ctx.api.onPermissionRequest?.(addPermissionBar);
  on('state', updateBookmarksBar);
  loadBookmarks();
  new ResizeObserver(() => {
    const items = $('#bookmarks-items');
    $('#bookmarks-more').hidden = items.scrollWidth <= items.clientWidth + 1;
  }).observe($('#bookmarks-items'));
}
