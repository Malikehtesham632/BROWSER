import { $, ctx, el, emit, on, reportUiError, setIcon, siteIcon } from './shared.js';

const DEFAULT_SITES = [
  { url: 'https://en.wikipedia.org/', title: 'Wikipedia' },
  { url: 'https://github.com/', title: 'GitHub' },
  { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs' },
  { url: 'https://news.ycombinator.com/', title: 'Hacker News' },
  { url: 'https://www.python.org/', title: 'Python' },
  { url: 'https://stackoverflow.com/', title: 'Stack Overflow' },
  { url: 'https://www.youtube.com/', title: 'YouTube' },
  { url: 'https://www.openstreetmap.org/', title: 'OpenStreetMap' }
];
const MAX_TILES = 8;

let refreshTimer = null;

export async function renderShortcuts() {
  let sites = [];
  try {
    sites = (await ctx.api.topSites(MAX_TILES)) || [];
  } catch {
    sites = [];
  }
  const seen = new Set(sites.map((site) => new URL(site.url).host.replace(/^www\./, '')));
  for (const fallback of DEFAULT_SITES) {
    if (sites.length >= MAX_TILES) break;
    const host = new URL(fallback.url).host.replace(/^www\./, '');
    if (seen.has(host)) continue;
    seen.add(host);
    sites.push(fallback);
  }
  const grid = $('#shortcut-grid');
  grid.replaceChildren(
    ...sites.slice(0, MAX_TILES).map((site, index) => {
      const tile = el(
        'button',
        { class: 'shortcut', type: 'button', title: site.url },
        siteIcon({ url: site.url, icon: site.icon, title: site.title, variant: 'tile' }),
        el('span', { class: 'label', text: site.title })
      );
      tile.style.animationDelay = `${index * 35}ms`;
      tile.addEventListener('click', (event) =>
        emit('navigate:request', { url: site.url, newTab: event.ctrlKey || event.metaKey })
      );
      tile.addEventListener('auxclick', (event) => {
        if (event.button === 1) emit('navigate:request', { url: site.url, newTab: true });
      });
      return tile;
    })
  );
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(renderShortcuts, 300);
}

async function generateIdeas() {
  const button = $('#ai-generate');
  const status = $('#ai-status');
  const box = $('#ai-queries');
  const topic = $('#hero-search').value.trim() || ctx.lastQuery || '';
  if (topic.length < 2) {
    status.textContent = 'Type a topic in the search box first, then press Generate ideas.';
    return;
  }
  button.disabled = true;
  button.classList.add('loading');
  status.textContent = `Thinking about “${topic}”…`;
  box.hidden = true;
  box.replaceChildren();
  try {
    const result = await ctx.api.generateQueries(topic);
    const queries = (result?.queries || [])
      .map((item) => String(item.query || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!queries.length) {
      status.textContent = 'No ideas this time. Try a different topic.';
      return;
    }
    status.textContent = 'Tap an idea to search it.';
    box.replaceChildren(
      ...queries.map((query, index) => {
        const chip = el('button', { class: 'ai-query', type: 'button', text: query });
        chip.style.animationDelay = `${index * 50}ms`;
        chip.addEventListener('click', () => emit('search:submit', { query }));
        return chip;
      })
    );
    box.hidden = false;
  } catch (error) {
    const message = String(error?.message || '');
    status.textContent = /not configured|GEMINI/i.test(message)
      ? 'AI ideas need a Gemini key. Add GEMINI_API_KEY to your settings file and restart.'
      : reportUiError('generate queries', error);
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
}

export function initNewTab() {
  setIcon($('#hero-icon'), 'search');
  setIcon($('#hero-submit'), 'arrow');
  $('#hero-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#hero-search').value;
    if (query.trim()) emit('search:submit', { query });
  });
  $('#ai-generate').addEventListener('click', generateIdeas);
  on('home:shown', renderShortcuts);
  on('library:changed', (kind) => {
    if (kind === 'history' || kind === 'bookmarks' || kind === 'all') scheduleRefresh();
  });
  renderShortcuts();
}

export function focusHero() {
  const input = $('#hero-search');
  input.focus();
  input.select();
}
