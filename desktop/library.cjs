const fs = require('node:fs/promises');
const path = require('node:path');

const LIMITS = { history: 5000, bookmarks: 2000, searches: 60, icons: 1500, text: 300, url: 2048 };
const DAY_MS = 86400000;

function cleanText(value, max = LIMITS.text) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function keyOf(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.href.length > LIMITS.url) return null;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function originOf(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isIconUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' && parsed.href.length <= LIMITS.url;
  } catch {
    return false;
  }
}

function tokensOf(text) {
  return cleanText(text, 200).toLowerCase().split(' ').filter(Boolean);
}

class Library {
  constructor(file, { now = Date.now, saveDelayMs = 400 } = {}) {
    this.file = file;
    this.now = now;
    this.saveDelayMs = saveDelayMs;
    this.data = { version: 1, bookmarks: [], history: [], searches: [], icons: {} };
    this.historyIndex = new Map();
    this.nextId = 1;
    this.timer = null;
    this.writing = Promise.resolve();
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    let raw = null;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (raw !== null) {
      try {
        this.#load(JSON.parse(raw));
      } catch {
        await fs.rename(this.file, `${this.file}.corrupt`).catch(() => {});
      }
    }
    this.ready = true;
  }

  #load(parsed) {
    const data = parsed && typeof parsed === 'object' ? parsed : {};
    const seen = new Set();
    this.data.bookmarks = [];
    for (const item of Array.isArray(data.bookmarks) ? data.bookmarks : []) {
      const key = keyOf(item?.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      this.data.bookmarks.push({
        id: `b${this.nextId++}`,
        url: key,
        title: cleanText(item.title) || hostOf(key),
        addedAt: Number(item.addedAt) || this.now()
      });
    }
    this.data.history = [];
    this.historyIndex.clear();
    for (const item of Array.isArray(data.history) ? data.history : []) {
      const key = keyOf(item?.url);
      if (!key || this.historyIndex.has(key)) continue;
      const entry = {
        url: key,
        title: cleanText(item.title) || hostOf(key),
        visitCount: Math.max(1, Number(item.visitCount) || 1),
        firstVisit: Number(item.firstVisit) || Number(item.lastVisit) || this.now(),
        lastVisit: Number(item.lastVisit) || this.now()
      };
      this.data.history.push(entry);
      this.historyIndex.set(key, entry);
    }
    this.data.searches = (Array.isArray(data.searches) ? data.searches : [])
      .map((item) => ({
        query: cleanText(item?.query, 300),
        count: Math.max(1, Number(item?.count) || 1),
        lastUsed: Number(item?.lastUsed) || this.now()
      }))
      .filter((item) => item.query)
      .slice(0, LIMITS.searches);
    this.data.icons = {};
    for (const [origin, icon] of Object.entries(
      data.icons && typeof data.icons === 'object' ? data.icons : {}
    )) {
      if (originOf(origin) === origin && isIconUrl(icon)) this.data.icons[origin] = icon;
    }
  }

  iconFor(url) {
    const origin = originOf(url);
    return origin ? this.data.icons[origin] || '' : '';
  }

  bookmarks() {
    return this.data.bookmarks.map((item) => ({ ...item, icon: this.iconFor(item.url) }));
  }

  isBookmarked(url) {
    const key = keyOf(url);
    return Boolean(key) && this.data.bookmarks.some((item) => item.url === key);
  }

  addBookmark(url, title) {
    const key = keyOf(url);
    if (!key) return null;
    const existing = this.data.bookmarks.find((item) => item.url === key);
    if (existing) return existing;
    if (this.data.bookmarks.length >= LIMITS.bookmarks) return null;
    const bookmark = {
      id: `b${this.nextId++}`,
      url: key,
      title: cleanText(title) || hostOf(key),
      addedAt: this.now()
    };
    this.data.bookmarks.push(bookmark);
    this.#scheduleSave();
    return bookmark;
  }

  removeBookmark(idOrUrl) {
    const key = keyOf(idOrUrl);
    const before = this.data.bookmarks.length;
    this.data.bookmarks = this.data.bookmarks.filter(
      (item) => item.id !== idOrUrl && (key === null || item.url !== key)
    );
    const removed = this.data.bookmarks.length !== before;
    if (removed) this.#scheduleSave();
    return removed;
  }

  toggleBookmark(url, title) {
    if (this.isBookmarked(url)) {
      this.removeBookmark(url);
      return { bookmarked: false };
    }
    const bookmark = this.addBookmark(url, title);
    return { bookmarked: Boolean(bookmark), bookmark };
  }

  recordVisit(url, title) {
    const key = keyOf(url);
    if (!key) return null;
    const time = this.now();
    let entry = this.historyIndex.get(key);
    if (entry) {
      entry.visitCount += 1;
      entry.lastVisit = time;
      const clean = cleanText(title);
      if (clean) entry.title = clean;
    } else {
      entry = {
        url: key,
        title: cleanText(title) || hostOf(key),
        visitCount: 1,
        firstVisit: time,
        lastVisit: time
      };
      this.data.history.push(entry);
      this.historyIndex.set(key, entry);
      this.#trimHistory();
    }
    this.#scheduleSave();
    return entry;
  }

  updateTitle(url, title) {
    const key = keyOf(url);
    const clean = cleanText(title);
    if (!key || !clean) return;
    const entry = this.historyIndex.get(key);
    if (entry && entry.title !== clean) {
      entry.title = clean;
      this.#scheduleSave();
    }
    const bookmark = this.data.bookmarks.find((item) => item.url === key);
    if (bookmark && bookmark.title === hostOf(key)) {
      bookmark.title = clean;
      this.#scheduleSave();
    }
  }

  setIcon(pageUrl, iconUrl) {
    const origin = originOf(pageUrl);
    if (!origin || !isIconUrl(iconUrl)) return false;
    if (this.data.icons[origin] === iconUrl) return false;
    if (!this.data.icons[origin] && Object.keys(this.data.icons).length >= LIMITS.icons) {
      delete this.data.icons[Object.keys(this.data.icons)[0]];
    }
    this.data.icons[origin] = iconUrl;
    this.#scheduleSave();
    return true;
  }

  #trimHistory() {
    if (this.data.history.length <= LIMITS.history) return;
    this.data.history.sort((a, b) => b.lastVisit - a.lastVisit);
    for (const removed of this.data.history.splice(LIMITS.history)) {
      this.historyIndex.delete(removed.url);
    }
  }

  history({ query = '', limit = 200 } = {}) {
    const tokens = tokensOf(query);
    const max = Math.min(500, Math.max(1, Number(limit) || 200));
    return this.data.history
      .filter((entry) => {
        if (!tokens.length) return true;
        const text = `${entry.title} ${entry.url}`.toLowerCase();
        return tokens.every((token) => text.includes(token));
      })
      .sort((a, b) => b.lastVisit - a.lastVisit)
      .slice(0, max)
      .map((entry) => ({ ...entry, icon: this.iconFor(entry.url) }));
  }

  removeHistory(url) {
    const key = keyOf(url);
    if (!key || !this.historyIndex.has(key)) return false;
    this.historyIndex.delete(key);
    this.data.history = this.data.history.filter((entry) => entry.url !== key);
    this.#scheduleSave();
    return true;
  }

  clearHistory() {
    const count = this.data.history.length;
    this.data.history = [];
    this.historyIndex.clear();
    this.data.searches = [];
    this.#scheduleSave();
    return count;
  }

  addSearch(query) {
    const clean = cleanText(query, 300);
    if (!clean) return;
    const lower = clean.toLowerCase();
    const existing = this.data.searches.find((item) => item.query.toLowerCase() === lower);
    if (existing) {
      existing.count += 1;
      existing.lastUsed = this.now();
      existing.query = clean;
    } else {
      this.data.searches.unshift({ query: clean, count: 1, lastUsed: this.now() });
    }
    this.data.searches.sort((a, b) => b.lastUsed - a.lastUsed);
    this.data.searches.length = Math.min(this.data.searches.length, LIMITS.searches);
    this.#scheduleSave();
  }

  searches(limit = 8) {
    return this.data.searches.slice(0, Math.max(1, Number(limit) || 8)).map((item) => item.query);
  }

  #frecency(entry) {
    const ageDays = Math.max(0, (this.now() - entry.lastVisit) / DAY_MS);
    return (Math.log2(1 + entry.visitCount) * 100) / (1 + ageDays / 7);
  }

  topSites(limit = 8) {
    const max = Math.min(24, Math.max(1, Number(limit) || 8));
    const hosts = new Map();
    for (const entry of this.data.history) {
      const origin = originOf(entry.url);
      if (!origin) continue;
      const score = this.#frecency(entry);
      const current = hosts.get(origin);
      if (current) current.score += score;
      else hosts.set(origin, { origin, score, host: hostOf(entry.url) });
    }
    for (const bookmark of this.data.bookmarks) {
      const origin = originOf(bookmark.url);
      if (!origin) continue;
      const current = hosts.get(origin);
      if (current) current.score += 150;
      else hosts.set(origin, { origin, score: 150, host: hostOf(bookmark.url) });
    }
    return [...hosts.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((site) => ({
        url: `${site.origin}/`,
        title: site.host,
        icon: this.data.icons[site.origin] || ''
      }));
  }

  suggest(query, limit = 8) {
    const text = cleanText(query, 200).toLowerCase();
    const tokens = text.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const max = Math.min(12, Math.max(1, Number(limit) || 8));
    const rows = new Map();
    const consider = (url, title, bookmarked, entry) => {
      const haystack = `${title} ${url}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return;
      const host = hostOf(url);
      let score = entry ? this.#frecency(entry) : 0;
      if (bookmarked) score += 500;
      if (host.startsWith(text)) score += 400;
      else if (host.includes(text)) score += 120;
      if (String(title).toLowerCase().startsWith(text)) score += 200;
      const existing = rows.get(url);
      if (existing) {
        existing.score = Math.max(existing.score, score);
        existing.type = existing.type === 'bookmark' || bookmarked ? 'bookmark' : 'history';
        return;
      }
      rows.set(url, {
        type: bookmarked ? 'bookmark' : 'history',
        title: title || host,
        url,
        icon: this.iconFor(url),
        score
      });
    };
    for (const bookmark of this.data.bookmarks) {
      consider(bookmark.url, bookmark.title, true, this.historyIndex.get(bookmark.url));
    }
    for (const entry of this.data.history) consider(entry.url, entry.title, false, entry);
    const pages = [...rows.values()].sort((a, b) => b.score - a.score).slice(0, max);
    const searches = this.data.searches
      .filter((item) => tokens.every((token) => item.query.toLowerCase().includes(token)))
      .slice(0, 3)
      .map((item) => ({
        type: 'search',
        title: item.query,
        query: item.query,
        score: 150 + item.count
      }));
    const merged = [...pages.slice(0, 2), ...searches, ...pages.slice(2)].slice(0, max);
    return merged.map(({ score, ...row }) => row);
  }

  #scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.saveDelayMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }
}

module.exports = { Library, keyOf, originOf, hostOf, isIconUrl, cleanText, LIMITS };
