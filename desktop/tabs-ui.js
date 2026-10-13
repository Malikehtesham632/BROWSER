import { $, ctx, el, emit, icon, on, siteIcon } from './shared.js';

const nodes = new Map();

function faviconFor(tab) {
  if (tab.loading) return el('span', { class: 'site-icon spinner' });
  if (tab.isHome && !tab.url) return el('span', { class: 'site-icon nova' }, 'N');
  return siteIcon({ url: tab.url, icon: tab.favicon, title: tab.title });
}

function tabLabel(tab) {
  if (tab.title) return tab.title;
  return tab.isHome ? 'New tab' : tab.url || 'New tab';
}

function buildTab(tab) {
  const iconSlot = el('span', { class: 'tab-icon' });
  const title = el('span', { class: 'tab-title' });
  const close = el(
    'button',
    { class: 'tab-close', type: 'button', 'aria-label': 'Close tab', tabindex: '-1' },
    icon('close')
  );
  const node = el(
    'div',
    { class: 'tab entering', role: 'tab', tabindex: '0', dataset: { id: tab.id } },
    iconSlot,
    title,
    close
  );
  node.addEventListener('animationend', () => node.classList.remove('entering'), { once: true });
  node.addEventListener('click', (event) => {
    if (event.target.closest('.tab-close')) return;
    ctx.api.activateTab(node.dataset.id).catch(() => {});
  });
  node.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      ctx.api.closeTab(node.dataset.id).catch(() => {});
    }
  });
  node.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    ctx.api.tabMenu(node.dataset.id).catch(() => {});
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ctx.api.activateTab(node.dataset.id).catch(() => {});
    }
  });
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.api.closeTab(node.dataset.id).catch(() => {});
  });
  return node;
}

function updateTab(node, tab, active) {
  const label = tabLabel(tab);
  node.classList.toggle('active', active);
  node.classList.toggle('pinned', Boolean(tab.pinned));
  node.setAttribute('aria-selected', String(active));
  node.title = label;
  const title = $('.tab-title', node);
  if (title.textContent !== label) title.textContent = label;
  const key = `${tab.loading ? 'L' : 'S'}|${tab.favicon || ''}|${tab.isHome && !tab.url ? 'H' : tab.url ? new URL(tab.url, 'https://x.invalid').host : ''}`;
  if (node.dataset.iconKey !== key) {
    node.dataset.iconKey = key;
    $('.tab-icon', node).replaceChildren(faviconFor(tab));
  }
  $('.tab-close', node).setAttribute('aria-label', `Close ${label}`);
}

function revealTab(strip, node) {
  if (!node) return;
  const left = node.offsetLeft - strip.offsetLeft;
  const right = left + node.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 6);
  else if (right > strip.scrollLeft + strip.clientWidth)
    strip.scrollLeft = right - strip.clientWidth + 6;
}

export function renderTabs(state) {
  const strip = $('#tabs');
  const seen = new Set();
  state.tabs.forEach((tab, index) => {
    seen.add(tab.id);
    let node = nodes.get(tab.id);
    if (!node) {
      node = buildTab(tab);
      nodes.set(tab.id, node);
    }
    updateTab(node, tab, tab.id === state.activeTabId);
    if (strip.children[index] !== node) strip.insertBefore(node, strip.children[index] || null);
  });
  for (const [id, node] of [...nodes]) {
    if (seen.has(id)) continue;
    node.remove();
    nodes.delete(id);
  }
  revealTab(strip, nodes.get(state.activeTabId));
}

export function initTabs() {
  const strip = $('#tabs');
  const newTab = $('#new-tab');
  newTab.append(icon('plus'));
  newTab.addEventListener('click', () => emit('command', 'new-tab'));
  strip.addEventListener(
    'wheel',
    (event) => {
      if (!event.deltaY || event.shiftKey) return;
      strip.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false }
  );
  $('.tab-strip').addEventListener('dblclick', (event) => {
    if (event.target === event.currentTarget || event.target === strip) emit('command', 'new-tab');
  });
  on('state', renderTabs);
}
