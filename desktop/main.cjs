const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { normalizeBrowserAddress } = require('./browser-url.cjs');

let engine;
let store;
let queryGenerator;
let window;
let configFile;
let config;
let engineServer;
let updateFeedConfigured = false;
let updaterInitialized = false;
let chromeHeight = 96;
let nextTabId = 1;
let activeTabId = null;
const tabs = new Map();
const closedTabs = [];

app.setName('Nova Browser');
app.setAppUserModelId('com.nova.browser');
app.setPath('userData', path.join(app.getPath('appData'), 'Nova Browser'));

function publicTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    favicon: tab.favicon,
    pinned: tab.pinned,
    audible: tab.audible,
    muted: tab.muted,
    canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
    canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
    isHome: tab.isHome
  };
}

function sendState() {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('browser:state', {
    activeTabId,
    tabs: [...tabs.values()].map(publicTab)
  });
}

function updateViewBounds() {
  if (!window || window.isDestroyed()) return;
  const { width, height } = window.getContentBounds();
  for (const tab of tabs.values()) {
    tab.view.setBounds({
      x: 0,
      y: Math.min(chromeHeight, height),
      width,
      height: Math.max(0, height - chromeHeight)
    });
    tab.view.setVisible(tab.id === activeTabId && !tab.isHome);
  }
}

function emitNavigationError(tab, url, error) {
  if (tab.failedNavigationUrl === url) return;
  tab.failedNavigationUrl = url;
  tab.loading = false;
  tab.isHome = true;
  tab.title = 'New tab';
  console.warn(`[Nova Browser] Navigation failed (${error?.code || 'unknown'}).`);
  updateViewBounds();
  sendState();
  if (tab.id !== activeTabId || !window || window.isDestroyed()) return;
  window.webContents.send('browser:navigation-error');
}

function reorderTabs(tabId, requestedIndex) {
  const ordered = [...tabs.entries()];
  const currentIndex = ordered.findIndex(([id]) => id === String(tabId));
  if (currentIndex < 0 || !Number.isInteger(requestedIndex)) return false;
  const [entry] = ordered.splice(currentIndex, 1);
  const pinnedCount = ordered.filter(([, tab]) => tab.pinned).length;
  const tab = entry[1];
  const minIndex = tab.pinned ? 0 : pinnedCount;
  const maxIndex = tab.pinned ? Math.max(0, pinnedCount - 1) : ordered.length;
  const targetIndex = Math.max(minIndex, Math.min(maxIndex, requestedIndex));
  ordered.splice(targetIndex, 0, entry);
  tabs.clear();
  for (const [id, value] of ordered) tabs.set(id, value);
  sendState();
  return true;
}

function activateAdjacentTab(direction) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return false;
  const current = ids.indexOf(activeTabId);
  const next = (current + direction + ids.length) % ids.length;
  return activateTab(ids[next]);
}

function createTab(initialUrl = null, { pinned = false } = {}) {
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
  const tab = { id, view, title: 'New tab', url: '', loading: false, isHome: true, pinned, favicon: null, audible: false, muted: false };
  tabs.set(id, tab);
  window.contentView.addChildView(view);

  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeBrowserAddress(url);
    if (safeUrl) createTab(safeUrl);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!normalizeBrowserAddress(url)) event.preventDefault();
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const command = input.control || input.meta;
    if (command && key === 'l') {
      event.preventDefault();
      if (window && !window.isDestroyed()) window.webContents.send('browser:focus-address');
    } else if (command && key === 't') {
      if (input.shift) {
        event.preventDefault();
        reopenClosedTab();
      } else {
        event.preventDefault();
        createTab();
      }
    } else if (command && key === 'w') {
      event.preventDefault();
      closeTab(tab.id);
    } else if (command && key === 'r') {
      event.preventDefault();
      if (contents.isLoading()) contents.stop();
      else contents.reload();
    } else if (command && key === 'f') {
      event.preventDefault();
      if (window && !window.isDestroyed()) window.webContents.send('browser:open-find');
    } else if (command && key === 'tab') {
      event.preventDefault();
      activateAdjacentTab(input.shift ? -1 : 1);
    } else if (input.key === 'F11') {
      event.preventDefault();
      if (window && !window.isDestroyed()) window.setFullScreen(!window.isFullScreen());
    } else if (input.alt && key === 'arrowleft' && contents.navigationHistory.canGoBack()) {
      event.preventDefault();
      contents.navigationHistory.goBack();
    } else if (input.alt && key === 'arrowright' && contents.navigationHistory.canGoForward()) {
      event.preventDefault();
      contents.navigationHistory.goForward();
    }
  });
  contents.on('found-in-page', (_event, result) => {
    if (tab.id === activeTabId && window && !window.isDestroyed()) {
      window.webContents.send('browser:find-result', {
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal
      });
    }
  });
  contents.on('did-start-navigation', (_event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = normalizeBrowserAddress(url) || tab.url;
    tab.loading = true;
    tab.isHome = false;
    sendState();
  });
  contents.on('did-navigate', (_event, url) => {
    tab.url = normalizeBrowserAddress(url) || '';
    tab.title = contents.getTitle() || tab.url || 'New tab';
    tab.loading = false;
    tab.isHome = false;
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
    sendState();
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    const candidate = favicons.find(icon => /^https?:\/\//i.test(icon) || icon.startsWith('data:image/'));
    if (candidate) tab.favicon = candidate;
    sendState();
  });
  contents.on('audio-state-changed', (_event, { audible, muted }) => {
    tab.audible = Boolean(audible);
    tab.muted = Boolean(muted);
    sendState();
  });
  contents.on('did-stop-loading', () => {
    tab.loading = false;
    sendState();
  });
  contents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    tab.loading = false;
    sendState();
    emitNavigationError(tab, url, description);
  });

  activeTabId = id;
  updateViewBounds();
  sendState();
  if (initialUrl) {
    navigateTab(tab, initialUrl).catch(() => {});
  }
  return id;
}

function activeTab() {
  return tabs.get(activeTabId);
}

function navigateTab(tab, input) {
  const url = normalizeBrowserAddress(input);
  if (!url) throw new TypeError('Enter a valid HTTP or HTTPS address.');
  tab.failedNavigationUrl = null;
  tab.isHome = false;
  tab.loading = true;
  tab.url = url;
  sendState();
  return tab.view.webContents.loadURL(url).catch(error => {
    tab.loading = false;
    sendState();
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return false;
    emitNavigationError(tab, url, error);
    throw error;
  });
}

function activateTab(id) {
  if (!tabs.has(String(id))) return false;
  activeTabId = String(id);
  updateViewBounds();
  sendState();
  return true;
}

function closeTab(id, { remember = true } = {}) {
  const key = String(id);
  const tab = tabs.get(key);
  if (!tab) return false;
  const wasActive = activeTabId === key;
  if (remember && !tab.pinned) {
    closedTabs.push({ url: tab.isHome ? null : tab.url });
    if (closedTabs.length > 10) closedTabs.shift();
  }
  tabs.delete(key);
  window.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  if (!tabs.size) {
    createTab();
  } else if (wasActive) {
    activeTabId = [...tabs.keys()].at(-1);
    updateViewBounds();
    sendState();
  } else {
    sendState();
  }
  return true;
}

function reopenClosedTab() {
  const closed = closedTabs.pop();
  if (!closed) return false;
  createTab(closed.url);
  return true;
}

function duplicateTab(id) {
  const source = tabs.get(String(id));
  if (!source) return false;
  createTab(source.isHome ? null : source.url);
  return true;
}

function configureUpdater() {
  if (updaterInitialized) return;
  updaterInitialized = true;
  let updateUrl = process.env.NOVA_UPDATE_URL?.trim();
  if (!updateUrl && app.isPackaged) {
    try {
      const metadata = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
      updateUrl = metadata.match(/^url:\s*(.+)$/m)?.[1]?.trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!updateUrl) {
    window?.webContents.send('updater:state', { state: 'not-configured' });
    return;
  }
  let parsed;
  try {
    parsed = new URL(updateUrl);
  } catch {
    console.error('[Nova Browser] Update feed URL is invalid.');
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.hostname === 'example.com' || parsed.hostname.endsWith('.example.com') ||
      parsed.hostname.includes('your-update-host')) {
    console.error('[Nova Browser] Ignoring an invalid or unsafe update feed URL.');
    return;
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: parsed.toString() });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  updateFeedConfigured = true;
  autoUpdater.on('checking-for-update', () => window?.webContents.send('updater:state', { state: 'checking' }));
  autoUpdater.on('update-available', info => window?.webContents.send('updater:state', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => window?.webContents.send('updater:state', { state: 'up-to-date' }));
  autoUpdater.on('download-progress', progress => window?.webContents.send('updater:state', {
    state: 'downloading',
    percent: Math.round(progress.percent)
  }));
  autoUpdater.on('update-downloaded', info => window?.webContents.send('updater:state', { state: 'downloaded', version: info.version }));
  autoUpdater.on('error', error => {
    console.error('[Nova Browser] Update check failed:', error.message);
    window?.webContents.send('updater:state', { state: 'error' });
  });
}

async function checkForUpdates() {
  if (!updateFeedConfigured) return { state: 'not-configured' };
  await autoUpdater.checkForUpdates();
  return { state: 'checking' };
}

function registerIpc() {
  ipcMain.handle('omni:search', async (event, query, searchId) => {
    if (typeof query !== 'string' || query.length > 300) throw new TypeError('Search query must be at most 300 characters.');
    if (!engine.providerNames().length && !engine.indexStats().documents) {
      throw new Error(`No search provider or local index is configured. Add a provider key to ${configFile} and restart Nova Browser.`);
    }
    if (Number.isSafeInteger(searchId) && !event.sender.isDestroyed()) {
      event.sender.send('omni:search-progress', {
        searchId,
        stage: 'start',
        providers: engine.providerNames(),
        indexDocuments: engine.indexStats().documents || 0
      });
    }
    const onProvider = Number.isSafeInteger(searchId)
      ? progress => {
        if (!progress.provider.ok && !progress.provider.skipped) {
          console.warn(`[Nova Browser] Search source ${progress.provider.name} failed: ${progress.provider.error}`);
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
      throw new Error(`AI query generation is not configured. Add GEMINI_API_KEY to ${configFile} and restart Nova Browser.`);
    }
    return queryGenerator.classifyAndExpand(query.trim(), { count: 5 });
  });
  ipcMain.handle('omni:get-search-status', () => ({
    providers: engine.providerNames(),
    indexDocuments: engine.indexStats().documents || 0,
    aiConfigured: Boolean(queryGenerator)
  }));
  ipcMain.handle('browser:get-state', () => ({
    activeTabId,
    tabs: [...tabs.values()].map(publicTab)
  }));
  ipcMain.handle('browser:new-tab', () => createTab());
  ipcMain.handle('browser:close-tab', (_event, id) => closeTab(id));
  ipcMain.handle('browser:activate-tab', (_event, id) => activateTab(id));
  ipcMain.handle('browser:duplicate-tab', (_event, id) => duplicateTab(id));
  ipcMain.handle('browser:reopen-closed-tab', () => reopenClosedTab());
  ipcMain.handle('browser:move-tab', (_event, id, index) => reorderTabs(id, index));
  ipcMain.handle('browser:pin-tab', (_event, id) => {
    const tab = tabs.get(String(id));
    if (!tab) return false;
    tab.pinned = !tab.pinned;
    reorderTabs(id, tab.pinned ? 0 : tabs.size - 1);
    sendState();
    return true;
  });
  ipcMain.handle('browser:mute-tab', (_event, id) => {
    const tab = tabs.get(String(id));
    if (!tab) return false;
    tab.muted = !tab.muted;
    tab.view.webContents.setAudioMuted(tab.muted);
    sendState();
    return tab.muted;
  });
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
  ipcMain.handle('browser:reload', () => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return false;
    if (contents.isLoading()) contents.stop();
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
    updateViewBounds();
    sendState();
    return true;
  });
  ipcMain.handle('browser:zoom', (_event, action) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return 100;
    const current = contents.getZoomFactor();
    const next = action === 'in'
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
  ipcMain.handle('browser:find-in-page', (_event, query, direction) => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return null;
    const value = typeof query === 'string' ? query.slice(0, 300) : '';
    if (!value.trim()) {
      contents.stopFindInPage('clearSelection');
      return null;
    }
    return contents.findInPage(value, { forward: direction !== 'backward' });
  });
  ipcMain.handle('browser:stop-find-in-page', () => {
    const contents = activeTab()?.view.webContents;
    if (!contents) return false;
    contents.stopFindInPage('clearSelection');
    return true;
  });
  ipcMain.handle('browser:toggle-fullscreen', () => {
    if (!window || window.isDestroyed()) return false;
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });
  ipcMain.handle('browser:exit', () => {
    app.quit();
    return true;
  });
  ipcMain.on('browser:chrome-height', (_event, height) => {
    if (!Number.isFinite(height)) return;
    chromeHeight = Math.max(72, Math.min(620, Math.round(height)));
    updateViewBounds();
  });
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', async () => {
    if (!updateFeedConfigured) throw new Error('Updates are not configured for this build.');
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
}

async function initialize() {
  if (engineServer?.listening) {
    await createBrowserWindow();
    return;
  }
  const root = app.getAppPath();
  const importFromRoot = file => import(pathToFileURL(path.join(root, file)).href);
  const { loadConfig, loadEnvFile } = await importFromRoot('src/config.js');
  const { createSearchEngine } = await importFromRoot('src/search.js');
  const { DocumentStore } = await importFromRoot('src/index/store.js');
  const { createGeminiClient } = await importFromRoot('src/ai/gemini.js');
  const { AICache } = await importFromRoot('src/ai/cache.js');
  const { QueryCorpus } = await importFromRoot('src/queries/corpus.js');
  const { createQueryGenerator } = await importFromRoot('src/queries/generator.js');

  const userDataPath = app.getPath('userData');
  configFile = path.join(app.isPackaged ? userDataPath : root, '.env');
  loadEnvFile(configFile);
  config = loadConfig();
  const dataPath = path.join(userDataPath, 'data');
  fs.mkdirSync(dataPath, { recursive: true });
  if (!process.env.OMNI_INDEX_FILE) config.indexFile = path.join(dataPath, 'omni-index.json');
  if (!process.env.OMNI_QUERY_CORPUS_FILE) config.ai.corpusFile = path.join(dataPath, 'query-corpus.json');
  if (!process.env.GEMINI_CACHE_FILE) config.ai.cacheFile = path.join(dataPath, 'gemini-query-cache.json');
  if (!process.env.OMNI_CRAWL_FRONTIER_FILE) config.crawler.frontierFile = path.join(dataPath, 'crawl-frontier.json');
  config.server.host = '127.0.0.1';
  config.frontierFile = path.join(dataPath, 'crawl-frontier.json');
  const store = new DocumentStore(config.indexFile);
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
  const serverModule = await importFromRoot('src/server.js');
  engineServer = serverModule.createServer(engine, config, { queryCorpus: corpus, queryGenerator });
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    engineServer.once('error', onError);
    engineServer.listen(config.server.port, config.server.host, () => {
      engineServer.removeListener('error', onError);
      resolve();
    });
  });
  registerIpc();
  configureUpdater();
  await createBrowserWindow();
}

async function createBrowserWindow() {
  if (window && !window.isDestroyed()) return;
  const root = app.getAppPath();
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#202124',
    title: 'Nova Browser',
    webPreferences: {
      preload: path.join(root, 'desktop', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  window.removeMenu();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'fullscreen');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'fullscreen');
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(error => console.error('[Nova Browser] Could not open external link:', error.message));
    return { action: 'deny' };
  });
  const { port } = engineServer.address();
  const appUrl = `http://127.0.0.1:${port}/browser`;
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl && !url.startsWith(`${appUrl}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(error => console.error('[Nova Browser] Could not open external link:', error.message));
    }
  });
  await window.loadURL(appUrl);
  if (!updateFeedConfigured) window.webContents.send('updater:state', { state: 'not-configured' });
  createTab();
  window.on('resize', updateViewBounds);
  window.on('closed', () => {
    window = null;
    tabs.clear();
    activeTabId = null;
  });
}

app.whenReady().then(initialize).catch(error => {
  console.error('Nova Browser startup failed:', error);
  dialog.showErrorBox('Nova Browser', 'We hit a small snag. Please give us a moment, then try again.');
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (engineServer?.listening) engineServer.close();
});
