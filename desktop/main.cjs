const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu, session } = require('electron');
const { normalizeBrowserAddress } = require('./browser-url.cjs');
const { Library } = require('./library.cjs');
const { createPermissionPolicy } = require('./permissions.cjs');

const PAGE_IGNORED_COMMANDS = new Set(['bookmarks-sidebar', 'focus-search']);
const MAX_CLOSED_TABS = 15;
const SNAPSHOT_TIMEOUT_MS = 600;
const NAVIGATION_ERROR_MESSAGE =
  'We could not open that page. Check the address or your connection, then try again.';

let engine;
let store;
let queryGenerator;
let window = null;
let configFile;
let library;
let permissions;
let shortcuts;
let layout = { top: 126, left: 0, right: 0, bottom: 0 };
let overlayOpen = false;
let nextTabId = 1;
let activeTabId = null;
let order = [];
let ipcRegistered = false;
let quitting = false;
let libraryTimer = null;
const closedTabs = [];
const tabs = new Map();

app.setName('Nova Browser');
app.setAppUserModelId('com.nova.browser');
app.setPath('userData', path.join(app.getPath('appData'), 'Nova Browser'));

function uiAlive() {
  return Boolean(window) && !window.isDestroyed();
}

function sendToUi(channel, payload) {
  if (!uiAlive() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function notifyLibrary(kind) {
  if (kind !== 'history') {
    sendToUi('library:changed', kind);
    return;
  }
  if (libraryTimer) return;
  libraryTimer = setTimeout(() => {
    libraryTimer = null;
    sendToUi('library:changed', 'history');
  }, 300);
}

function orderedTabs() {
  return order.map((id) => tabs.get(id)).filter(Boolean);
}

function activeTab() {
  return tabs.get(activeTabId);
}

function isTabContents(contents) {
  for (const tab of tabs.values()) {
    if (tab.view.webContents === contents) return true;
  }
  return false;
}

function publicTab(tab) {
  const contents = tab.view.webContents;
  const alive = !contents.isDestroyed();
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    loading: tab.loading,
    pinned: tab.pinned,
    bookmarked: Boolean(library && tab.url && library.isBookmarked(tab.url)),
    canGoBack: alive && contents.navigationHistory.canGoBack(),
    canGoForward: alive && contents.navigationHistory.canGoForward(),
    isHome: tab.isHome
  };
}

function publicState() {
  return { activeTabId, tabs: orderedTabs().map(publicTab) };
}

function sendState() {
  if (!uiAlive()) return;
  sendToUi('browser:state', publicState());
  const tab = activeTab();
  window.setTitle(tab && !tab.isHome && tab.title ? `${tab.title} — Nova Browser` : 'Nova Browser');
}

function clampInset(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Math.max(0, max), Math.round(number)));
}

function updateViewBounds() {
  if (!uiAlive()) return;
  const { width, height } = window.getContentBounds();
  const x = Math.min(layout.left, width);
  const y = Math.min(layout.top, height);
  const bounds = {
    x,
    y,
    width: Math.max(0, width - layout.left - layout.right),
    height: Math.max(0, height - layout.top - layout.bottom)
  };
  for (const tab of tabs.values()) {
    tab.view.setBounds(bounds);
    tab.view.setVisible(tab.id === activeTabId && !tab.isHome && !overlayOpen);
  }
}

async function setOverlay(open) {
  if (open === overlayOpen) return;
  overlayOpen = open;
  if (open) {
    const tab = activeTab();
    if (tab && !tab.isHome && !tab.view.webContents.isDestroyed()) {
      try {
        const image = await Promise.race([
          tab.view.webContents.capturePage(),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('snapshot timeout')), SNAPSHOT_TIMEOUT_MS)
          )
        ]);
        if (overlayOpen && image && !image.isEmpty()) {
          sendToUi('browser:snapshot', {
            dataUrl: `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`
          });
        }
      } catch (error) {
        console.warn('[Nova Browser] Could not capture the page behind the menu:', error.message);
      }
    }
  } else {
    sendToUi('browser:snapshot', null);
  }
  updateViewBounds();
}

function emitNavigationError(tab, url, error) {
  if (tab.failedNavigationUrl === url) return;
  tab.failedNavigationUrl = url;
  tab.loading = false;
  tab.isHome = true;
  tab.title = 'New tab';
  console.warn(`[Nova Browser] Navigation failed for ${url}:`, error);
  updateViewBounds();
  sendState();
  if (tab.id !== activeTabId) return;
  sendToUi('browser:navigation-error', { tabId: tab.id, url, message: NAVIGATION_ERROR_MESSAGE });
}

function pickFavicon(favicons) {
  if (!Array.isArray(favicons)) return '';
  return (
    favicons.find(
      (icon) => typeof icon === 'string' && icon.length <= 2048 && icon.startsWith('https://')
    ) || ''
  );
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function sortPinnedFirst() {
  order.sort((a, b) => Number(tabs.get(b).pinned) - Number(tabs.get(a).pinned));
}

function createTab(initialUrl = null, { afterId = null } = {}) {
  const id = String(nextTabId++);
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  const tab = {
    id,
    view,
    title: 'New tab',
    url: '',
    favicon: '',
    loading: false,
    isHome: true,
    pinned: false
  };
  tabs.set(id, tab);
  const position = afterId ? order.indexOf(afterId) : -1;
  if (position >= 0) order.splice(position + 1, 0, id);
  else order.push(id);
  sortPinnedFirst();
  window.contentView.addChildView(view);

  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeBrowserAddress(url);
    if (safeUrl) createTab(safeUrl, { afterId: id });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!normalizeBrowserAddress(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!normalizeBrowserAddress(url)) event.preventDefault();
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !shortcuts) return;
    const command = shortcuts.matchShortcut(shortcuts.fromElectronInput(input));
    if (!command || PAGE_IGNORED_COMMANDS.has(command)) return;
    event.preventDefault();
    sendToUi('browser:command', command);
  });
  contents.on('found-in-page', (_event, result) => {
    if (tab.id === activeTabId) {
      sendToUi('browser:find-result', {
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal
      });
    }
  });
  contents.on('did-start-navigation', (_event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    const next = normalizeBrowserAddress(url);
    if (next && tab.url && !sameOrigin(next, tab.url)) tab.favicon = '';
    tab.url = next || tab.url;
    tab.loading = true;
    tab.isHome = false;
    sendState();
  });
  contents.on('did-navigate', (_event, url) => {
    tab.url = normalizeBrowserAddress(url) || '';
    tab.title = contents.getTitle() || tab.url || 'New tab';
    tab.loading = false;
    tab.isHome = false;
    if (tab.url && library) {
      library.recordVisit(tab.url, tab.title);
      notifyLibrary('history');
    }
    sendState();
  });
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = normalizeBrowserAddress(url) || tab.url;
    sendState();
  });
  contents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    tab.title = title || tab.url || 'New tab';
    if (tab.url && title && library) library.updateTitle(tab.url, title);
    sendState();
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    const icon = pickFavicon(favicons);
    tab.favicon = icon;
    if (icon && tab.url && library && library.setIcon(tab.url, icon)) notifyLibrary('bookmarks');
    sendState();
  });
  contents.on('did-stop-loading', () => {
    tab.loading = false;
    sendState();
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    tab.loading = false;
    sendState();
    emitNavigationError(tab, url, description);
  });

  activeTabId = id;
  updateViewBounds();
  sendState();
  if (initialUrl) navigateTab(tab, initialUrl).catch(() => {});
  return id;
}

function navigateTab(tab, input) {
  const url = normalizeBrowserAddress(input);
  if (!url) throw new TypeError('Enter a valid HTTP or HTTPS address.');
  tab.failedNavigationUrl = null;
  tab.isHome = false;
  tab.loading = true;
  tab.url = url;
  sendState();
  return tab.view.webContents.loadURL(url).catch((error) => {
    tab.loading = false;
    sendState();
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return false;
    emitNavigationError(tab, url, error);
    throw error;
  });
}

function activateTab(id) {
  const key = String(id);
  if (!tabs.has(key)) return false;
  activeTabId = key;
  updateViewBounds();
  sendState();
  return true;
}

function closeTab(id, { remember = true } = {}) {
  const key = String(id);
  const tab = tabs.get(key);
  if (!tab) return false;
  const index = order.indexOf(key);
  const wasActive = activeTabId === key;
  if (remember && tab.url && !tab.isHome) {
    closedTabs.push({ url: tab.url, title: tab.title });
    if (closedTabs.length > MAX_CLOSED_TABS) closedTabs.shift();
  }
  tabs.delete(key);
  order = order.filter((value) => value !== key);
  if (uiAlive()) window.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (!tabs.size) {
    if (uiAlive()) createTab();
  } else if (wasActive) {
    activeTabId = order[Math.min(index, order.length - 1)];
    updateViewBounds();
    sendState();
  } else {
    sendState();
  }
  return true;
}

function closeOtherTabs(keepId) {
  for (const tab of orderedTabs()) {
    if (tab.id !== keepId && !tab.pinned) closeTab(tab.id);
  }
  activateTab(keepId);
}

function closeTabsToRight(id) {
  const index = order.indexOf(id);
  if (index < 0) return;
  for (const key of order.slice(index + 1)) {
    if (!tabs.get(key)?.pinned) closeTab(key);
  }
}

function cycleTab(delta) {
  if (order.length < 2) return false;
  const index = order.indexOf(activeTabId);
  const next = order[(index + delta + order.length) % order.length];
  return activateTab(next);
}

function reopenClosedTab() {
  const entry = closedTabs.pop();
  if (!entry) return false;
  createTab(entry.url);
  return true;
}

function setPinned(id, pinned) {
  const tab = tabs.get(String(id));
  if (!tab) return false;
  tab.pinned = Boolean(pinned);
  sortPinnedFirst();
  sendState();
  return true;
}

function showTabMenu(id) {
  const tab = tabs.get(String(id));
  if (!tab || !uiAlive()) return false;
  const index = order.indexOf(tab.id);
  const template = [
    { label: 'Reload tab', enabled: !tab.isHome, click: () => tab.view.webContents.reload() },
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => setPinned(tab.id, !tab.pinned) },
    {
      label: 'Duplicate tab',
      enabled: !tab.isHome && Boolean(tab.url),
      click: () => createTab(tab.url, { afterId: tab.id })
    },
    { type: 'separator' },
    { label: 'Close tab', click: () => closeTab(tab.id) },
    { label: 'Close other tabs', enabled: tabs.size > 1, click: () => closeOtherTabs(tab.id) },
    {
      label: 'Close tabs to the right',
      enabled: index < order.length - 1,
      click: () => closeTabsToRight(tab.id)
    },
    { type: 'separator' },
    { label: 'Reopen closed tab', enabled: closedTabs.length > 0, click: () => reopenClosedTab() }
  ];
  Menu.buildFromTemplate(template).popup({ window });
  return true;
}

function requireString(value, name, max = 2048) {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new TypeError(`${name} is not valid.`);
  return value;
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('omni:search', async (event, query, searchId) => {
    if (typeof query !== 'string' || query.length > 300)
      throw new TypeError('Search query must be at most 300 characters.');
    if (!engine.providerNames().length && !engine.indexStats().documents) {
      throw new Error(
        `No search provider or local index is configured. Add a provider key to ${configFile} and restart Nova Browser.`
      );
    }
    if (query.trim() && library) library.addSearch(query);
    if (Number.isSafeInteger(searchId) && !event.sender.isDestroyed()) {
      event.sender.send('omni:search-progress', {
        searchId,
        stage: 'start',
        providers: engine.providerNames(),
        indexDocuments: engine.indexStats().documents || 0
      });
    }
    const onProvider = Number.isSafeInteger(searchId)
      ? (progress) => {
          if (!progress.provider.ok && !progress.provider.skipped) {
            console.warn(
              `[Nova Browser] Search source ${progress.provider.name} failed: ${progress.provider.error}`
            );
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('omni:search-progress', {
              searchId,
              stage: 'provider',
              provider: progress.provider.name,
              resultCount: progress.provider.count,
              ok: progress.provider.ok,
              skipped: progress.provider.skipped,
              results: progress.results
            });
          }
        }
      : undefined;
    return engine.search(query, { limit: 12, onProvider });
  });
  ipcMain.handle('omni:generate-queries', async (_event, query) => {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) {
      throw new TypeError('Enter a topic between 2 and 300 characters.');
    }
    if (!queryGenerator) {
      throw new Error(
        `AI query generation is not configured. Add GEMINI_API_KEY to ${configFile} and restart Nova Browser.`
      );
    }
    return queryGenerator.classifyAndExpand(query.trim(), { count: 5 });
  });
  ipcMain.handle('omni:get-search-status', () => ({
    providers: engine.providerNames(),
    indexDocuments: engine.indexStats().documents || 0,
    aiConfigured: Boolean(queryGenerator)
  }));

  ipcMain.handle('browser:get-state', () => publicState());
  ipcMain.handle('browser:new-tab', (_event, url) => {
    if (url === undefined || url === null || url === '') return createTab();
    const safeUrl = normalizeBrowserAddress(url);
    if (!safeUrl) throw new TypeError('Enter a valid HTTP or HTTPS address.');
    return createTab(safeUrl);
  });
  ipcMain.handle('browser:close-tab', (_event, id) => closeTab(requireString(id, 'Tab id', 40)));
  ipcMain.handle('browser:activate-tab', (_event, id) =>
    activateTab(requireString(id, 'Tab id', 40))
  );
  ipcMain.handle('browser:cycle-tab', (_event, delta) => {
    if (delta !== 1 && delta !== -1) throw new TypeError('Tab direction is not valid.');
    return cycleTab(delta);
  });
  ipcMain.handle('browser:reopen-tab', () => reopenClosedTab());
  ipcMain.handle('browser:tab-menu', (_event, id) => showTabMenu(requireString(id, 'Tab id', 40)));
  ipcMain.handle('browser:navigate', (_event, address) => {
    const tab = activeTab();
    if (!tab) throw new Error('No active browser tab.');
    return navigateTab(tab, address);
  });
  ipcMain.handle('browser:go', (_event, direction) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return false;
    const history = contents.navigationHistory;
    if (direction === 'back' && history.canGoBack()) history.goBack();
    else if (direction === 'forward' && history.canGoForward()) history.goForward();
    else return false;
    return true;
  });
  ipcMain.handle('browser:reload', (_event, hard) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return false;
    if (contents.isLoading()) contents.stop();
    else if (hard === true) contents.reloadIgnoringCache();
    else contents.reload();
    return true;
  });
  ipcMain.handle('browser:home', () => {
    const tab = activeTab();
    if (!tab) return false;
    if (tab.view.webContents.isLoading()) tab.view.webContents.stop();
    tab.isHome = true;
    tab.loading = false;
    tab.title = 'New tab';
    tab.url = '';
    tab.favicon = '';
    updateViewBounds();
    sendState();
    return true;
  });
  ipcMain.handle('browser:zoom', (_event, action) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return 100;
    const current = contents.getZoomFactor();
    if (action === 'get') return Math.round(current * 100);
    const next =
      action === 'in'
        ? Math.min(2, Math.round((current + 0.1) * 10) / 10)
        : action === 'out'
          ? Math.max(0.5, Math.round((current - 0.1) * 10) / 10)
          : action === 'reset'
            ? 1
            : null;
    if (next === null) throw new TypeError('Unsupported zoom action.');
    contents.setZoomFactor(next);
    return Math.round(next * 100);
  });
  ipcMain.handle('browser:find-in-page', (_event, query, options) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return null;
    const value = typeof query === 'string' ? query.slice(0, 300) : '';
    if (!value.trim()) {
      contents.stopFindInPage('clearSelection');
      return null;
    }
    return contents.findInPage(value, {
      forward: options?.forward !== false,
      findNext: options?.findNext === true
    });
  });
  ipcMain.handle('browser:stop-find-in-page', () => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return false;
    contents.stopFindInPage('clearSelection');
    return true;
  });
  ipcMain.handle('browser:toggle-fullscreen', () => {
    if (!uiAlive()) return false;
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });
  ipcMain.handle('browser:exit', () => {
    app.quit();
    return true;
  });
  ipcMain.on('browser:layout', (event, insets) => {
    if (!uiAlive() || event.sender !== window.webContents || !insets || typeof insets !== 'object')
      return;
    const { width, height } = window.getContentBounds();
    layout = {
      top: clampInset(insets.top, height),
      left: clampInset(insets.left, width),
      right: clampInset(insets.right, width),
      bottom: clampInset(insets.bottom, height)
    };
    updateViewBounds();
  });
  ipcMain.handle('browser:overlay', (event, open) => {
    if (!uiAlive() || event.sender !== window.webContents) return false;
    return setOverlay(open === true).then(() => true);
  });

  ipcMain.handle('library:bookmarks', () => library.bookmarks());
  ipcMain.handle('library:toggle-bookmark', () => {
    const tab = activeTab();
    if (!tab || tab.isHome || !tab.url) throw new Error('Open a web page first.');
    const result = library.toggleBookmark(tab.url, tab.title);
    sendState();
    notifyLibrary('bookmarks');
    return { bookmarked: result.bookmarked };
  });
  ipcMain.handle('library:remove-bookmark', (_event, id) => {
    const removed = library.removeBookmark(requireString(id, 'Bookmark id'));
    if (removed) {
      sendState();
      notifyLibrary('bookmarks');
    }
    return removed;
  });
  ipcMain.handle('library:history', (_event, options) =>
    library.history({
      query: typeof options?.query === 'string' ? options.query.slice(0, 200) : '',
      limit: Number(options?.limit) || 200
    })
  );
  ipcMain.handle('library:remove-history', (_event, url) => {
    const removed = library.removeHistory(requireString(url, 'Address'));
    if (removed) notifyLibrary('history');
    return removed;
  });
  ipcMain.handle('library:clear-history', () => {
    const count = library.clearHistory();
    notifyLibrary('all');
    return count;
  });
  ipcMain.handle('library:top-sites', (_event, limit) => library.topSites(Number(limit) || 8));
  ipcMain.handle('library:suggest', (_event, query) =>
    typeof query === 'string' ? library.suggest(query.slice(0, 200), 8) : []
  );

  ipcMain.handle('permission:respond', (_event, id, allow) =>
    permissions.respond(requireString(id, 'Request id', 40), allow === true)
  );
}

function setupPermissions() {
  permissions = createPermissionPolicy({
    isKnownContents: (contents) => isTabContents(contents),
    ask: (request) => sendToUi('permission:request', request)
  });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    permissions.onRequest(contents, permission, callback, details);
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    permissions.onCheck(contents, permission, requestingOrigin)
  );
}

async function createMainWindow(root) {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#1c1b22',
    title: 'Nova Browser',
    webPreferences: {
      preload: path.join(root, 'desktop/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  window.removeMenu();
  window.on('resize', updateViewBounds);
  window.on('enter-full-screen', updateViewBounds);
  window.on('leave-full-screen', updateViewBounds);
  window.on('closed', () => {
    permissions?.denyAll();
    window = null;
    tabs.clear();
    order = [];
    activeTabId = null;
    overlayOpen = false;
  });
  await window.loadFile(path.join(root, 'desktop/index.html'));
  createTab();
}

async function initialize() {
  const root = app.getAppPath();
  const importFromRoot = (file) => import(pathToFileURL(path.join(root, file)).href);
  const { loadConfig, loadEnvFile } = await importFromRoot('src/config.js');
  const { createSearchEngine } = await importFromRoot('src/search.js');
  const { DocumentStore } = await importFromRoot('src/index/store.js');
  const { createGeminiClient } = await importFromRoot('src/ai/gemini.js');
  const { AICache } = await importFromRoot('src/ai/cache.js');
  const { QueryCorpus } = await importFromRoot('src/queries/corpus.js');
  const { createQueryGenerator } = await importFromRoot('src/queries/generator.js');
  shortcuts = await importFromRoot('desktop/shortcuts.js');
  const userDataPath = app.getPath('userData');
  configFile = path.join(app.isPackaged ? userDataPath : root, '.env');
  loadEnvFile(configFile);
  const config = loadConfig();
  if (!process.env.OMNI_INDEX_FILE) config.indexFile = path.join(userDataPath, 'omni-index.json');
  if (!process.env.OMNI_QUERY_CORPUS_FILE)
    config.ai.corpusFile = path.join(userDataPath, 'query-corpus.json');
  if (!process.env.GEMINI_CACHE_FILE)
    config.ai.cacheFile = path.join(userDataPath, 'gemini-query-cache.json');
  store = new DocumentStore(config.indexFile);
  await store.init();
  const corpus = new QueryCorpus(config.ai.corpusFile);
  await corpus.init();
  const aiCache = new AICache(config.ai.cacheFile, {
    ttlMs: config.ai.cacheTtlMs,
    maxEntries: config.ai.cacheMaxEntries
  });
  await aiCache.init();
  if (config.ai.apiKey) {
    queryGenerator = createQueryGenerator(createGeminiClient(config, { cache: aiCache }), corpus);
  }
  engine = createSearchEngine(config, { store });
  library = new Library(path.join(userDataPath, 'library.json'));
  await library.init();
  setupPermissions();
  registerIpc();
  await createMainWindow(root);
}

app
  .whenReady()
  .then(initialize)
  .catch((error) => {
    console.error('Nova Browser startup failed:', error);
    dialog.showErrorBox(
      'Nova Browser',
      'We hit a small snag. Please give us a moment, then try again.'
    );
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && engine) {
    createMainWindow(app.getAppPath()).catch((error) =>
      console.error('Nova Browser could not reopen its window:', error)
    );
  }
});

app.on('before-quit', (event) => {
  if (quitting || !library) return;
  quitting = true;
  event.preventDefault();
  library
    .flush()
    .catch((error) =>
      console.warn('[Nova Browser] Could not save bookmarks and history:', error.message)
    )
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
