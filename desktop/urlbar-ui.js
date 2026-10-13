import {
  $,
  activeTab,
  closeOverlay,
  ctx,
  el,
  emit,
  icon,
  on,
  openOverlay,
  setIcon,
  showToast,
  siteIcon
} from './shared.js';
import { addressUrl, displayUrl, hostOf, nextIndex } from './ui-helpers.js';

const addressByTab = new Map();
let input;
let panel;
let rows = [];
let selected = -1;
let typed = '';
let edited = false;
let requestId = 0;
let timer = null;
let shownKey = '';

function isOpen() {
  return !panel.hidden;
}

function closePanel() {
  clearTimeout(timer);
  requestId++;
  rows = [];
  selected = -1;
  panel.hidden = true;
  panel.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  closeOverlay('urlbar');
}

function highlight(text, query) {
  const fragment = document.createDocumentFragment();
  const source = String(text ?? '');
  const needle = query.trim().toLowerCase().split(/\s+/)[0] || '';
  const at = needle ? source.toLowerCase().indexOf(needle) : -1;
  if (at < 0) {
    fragment.append(source);
    return fragment;
  }
  fragment.append(
    source.slice(0, at),
    el('mark', { text: source.slice(at, at + needle.length) }),
    source.slice(at + needle.length)
  );
  return fragment;
}

function rowIcon(row) {
  if (row.type === 'search') return el('span', { class: 'suggestion-icon' }, icon('search'));
  if (row.type === 'visit') return el('span', { class: 'suggestion-icon' }, icon('globe'));
  if (row.type === 'bookmark' && !row.icon)
    return el('span', { class: 'suggestion-icon' }, icon('star', { filled: true }));
  return el(
    'span',
    { class: 'suggestion-icon' },
    siteIcon({ url: row.url, icon: row.icon, title: row.title })
  );
}

function rowText(row) {
  return row.type === 'search' ? row.query : row.url;
}

function renderRows() {
  panel.replaceChildren();
  const query = input.value;
  rows.forEach((row, index) => {
    const title =
      row.type === 'search' ? row.query : row.type === 'visit' ? displayUrl(row.url) : row.title;
    const sub =
      row.type === 'search'
        ? 'Search with Nova'
        : row.type === 'visit'
          ? 'Open this address'
          : displayUrl(row.url);
    const kind = { search: 'Search', visit: 'Visit', bookmark: 'Bookmark', history: '' }[row.type];
    const item = el(
      'li',
      { class: 'suggestion', role: 'option', id: `suggestion-${index}`, 'aria-selected': 'false' },
      rowIcon(row),
      el(
        'span',
        { class: 'suggestion-copy' },
        el('span', { class: 'suggestion-title' }, highlight(title, query)),
        el('span', { class: 'suggestion-sub', text: sub })
      ),
      kind ? el('span', { class: 'suggestion-kind', text: kind }) : null
    );
    item.addEventListener('mousemove', () => select(index, { fill: false }));
    item.addEventListener('click', (event) => choose(row, event.ctrlKey || event.metaKey));
    item.addEventListener('auxclick', (event) => {
      if (event.button === 1) choose(row, true);
    });
    panel.append(item);
  });
  const open = rows.length > 0;
  panel.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (open) openOverlay('urlbar');
  else closeOverlay('urlbar');
}

function select(index, { fill = true } = {}) {
  selected = index;
  [...panel.children].forEach((item, i) => {
    const on = i === index;
    item.classList.toggle('selected', on);
    item.setAttribute('aria-selected', String(on));
    if (on) {
      input.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  });
  if (index < 0) input.removeAttribute('aria-activedescendant');
  if (fill && index >= 0 && rows[index]) input.value = rowText(rows[index]);
  if (fill && index < 0) input.value = typed;
}

function choose(row, newTab = false) {
  closePanel();
  input.blur();
  if (row.type === 'search') emit('search:submit', { query: row.query });
  else emit('navigate:request', { url: row.url, newTab });
}

async function refreshSuggestions() {
  const text = typed.trim();
  if (!text) return closePanel();
  const mine = ++requestId;
  let found = [];
  try {
    found = (await ctx.api.suggest(text)) || [];
  } catch {
    found = [];
  }
  if (mine !== requestId || document.activeElement !== input) return;
  const url = addressUrl(text);
  const first = url ? { type: 'visit', url } : { type: 'search', query: text };
  const rest = found.filter(
    (row) => row.type !== 'search' || row.query?.toLowerCase() !== text.toLowerCase()
  );
  rows = [first, ...rest.filter((row) => !(url && row.url === url))].slice(0, 8);
  renderRows();
  select(0, { fill: false });
}

function setText(value, full = value) {
  input.value = value;
  input.dataset.full = full;
  $('#clear-address').hidden = !(document.activeElement === input && input.value);
}

function identityFor(tab) {
  const button = $('#identity');
  const label = $('#identity-label');
  button.classList.remove('secure', 'insecure');
  label.textContent = '';
  let name = 'search';
  if (tab && !tab.isHome && tab.url) {
    if (tab.url.startsWith('https://')) {
      name = 'lock';
      button.classList.add('secure');
      button.title = 'Connection is secure';
    } else if (tab.url.startsWith('http://')) {
      name = 'warning';
      button.classList.add('insecure');
      label.textContent = 'Not secure';
      button.title = 'Connection is not secure';
    }
  } else {
    button.title = 'Search with Nova';
  }
  setIcon($('#identity-icon'), name);
}

function updateFromState(state) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  identityFor(tab);
  const star = $('#bookmark-star');
  const canBookmark = Boolean(tab && !tab.isHome && tab.url);
  star.disabled = !canBookmark;
  star.classList.toggle('on', Boolean(tab?.bookmarked));
  star.setAttribute('aria-pressed', String(Boolean(tab?.bookmarked)));
  star.title = tab?.bookmarked
    ? 'Edit this bookmark (Ctrl+D removes it)'
    : 'Bookmark this page (Ctrl+D)';
  setIcon(star, 'star', { filled: Boolean(tab?.bookmarked) });
  if (!tab) return;
  const key = tab.isHome
    ? `${tab.id}|home|${addressByTab.get(tab.id) ?? ''}`
    : `${tab.id}|${tab.url}`;
  if (key === shownKey) return;
  shownKey = key;
  if (document.activeElement === input && edited) return;
  const text = tab.isHome ? (addressByTab.get(tab.id) ?? '') : tab.url || '';
  setText(document.activeElement === input ? text : tab.isHome ? text : displayUrl(text), text);
}

export function focusAddress() {
  input.focus();
  input.select();
}

export function initUrlbar() {
  input = $('#address');
  panel = $('#suggestions');
  setIcon($('#back'), 'back');
  setIcon($('#forward'), 'forward');
  setIcon($('#reload'), 'reload');
  setIcon($('#home'), 'home');
  setIcon($('#clear-address'), 'close');
  setIcon($('#bookmark-star'), 'star');
  setIcon($('#sidebar-toggle'), 'sidebar');
  setIcon($('#browser-menu-toggle'), 'menu');
  identityFor(null);

  let swallowMouseUp = false;
  input.addEventListener('mousedown', () => {
    swallowMouseUp = document.activeElement !== input;
  });
  input.addEventListener('mouseup', (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.preventDefault();
  });
  input.addEventListener('focus', () => {
    const full = input.dataset.full ?? input.value;
    input.value = full;
    edited = false;
    typed = full;
    input.select();
    $('#clear-address').hidden = !input.value;
  });
  input.addEventListener('blur', () => {
    closePanel();
    $('#clear-address').hidden = true;
    if (!edited) {
      const tab = activeTab();
      const full = input.dataset.full ?? input.value;
      input.value = tab && !tab.isHome ? displayUrl(full) : full;
    }
  });
  input.addEventListener('input', () => {
    edited = true;
    typed = input.value;
    $('#clear-address').hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(refreshSuggestions, 40);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!isOpen()) {
        if (typed.trim()) refreshSuggestions();
        return;
      }
      event.preventDefault();
      select(nextIndex(selected, rows.length, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (isOpen()) {
        closePanel();
        input.value = typed;
      } else {
        edited = false;
        input.value = input.dataset.full ?? '';
        input.blur();
      }
    } else if (event.key === 'Enter' && isOpen() && selected >= 0 && rows[selected]) {
      event.preventDefault();
      choose(rows[selected], event.ctrlKey || event.metaKey);
    }
  });
  panel.addEventListener('mousedown', (event) => event.preventDefault());
  $('#address-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value;
    closePanel();
    input.blur();
    emit('address:submit', { value });
  });
  $('#clear-address').addEventListener('mousedown', (event) => event.preventDefault());
  $('#clear-address').addEventListener('click', () => {
    input.value = '';
    typed = '';
    edited = true;
    closePanel();
    $('#clear-address').hidden = true;
    input.focus();
  });
  $('#bookmark-star').addEventListener('click', () => emit('command', 'bookmark'));
  $('#identity').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab || tab.isHome || !tab.url)
      return showToast('Search with Nova, or type a web address.');
    const host = hostOf(tab.url);
    showToast(
      tab.url.startsWith('https://')
        ? `Connection to ${host} is secure.`
        : `Connection to ${host} is not secure.`
    );
  });

  on('state', updateFromState);
  on('address:set', ({ tabId, value }) => {
    addressByTab.set(tabId, value);
    shownKey = '';
    const tab = activeTab();
    if (tab?.id === tabId) updateFromState(ctx.state);
  });
  on('address:forget', ({ tabId }) => {
    addressByTab.delete(tabId);
    shownKey = '';
  });
}
