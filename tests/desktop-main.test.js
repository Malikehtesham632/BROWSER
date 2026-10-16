import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

process.env.SEARXNG_ENABLED = 'false';
process.env.SEARXNG_INSTANCES = '';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-main-'));

class FakeContents extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.destroyed = false;
    this.loading = false;
    this.zoom = 1;
    this.url = '';
    this.title = '';
    this.finds = [];
    this.history = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack() {},
      goForward() {}
    };
    this.navigationHistory = this.history;
  }
  setWindowOpenHandler(handler) {
    this.openHandler = handler;
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.destroyed = true;
  }
  getTitle() {
    return this.title;
  }
  getURL() {
    return this.url;
  }
  isLoading() {
    return this.loading;
  }
  stop() {
    this.loading = false;
  }
  reload() {
    this.reloaded = (this.reloaded || 0) + 1;
  }
  reloadIgnoringCache() {
    this.hardReloaded = true;
  }
  loadURL(url) {
    this.url = url;
    this.title = `Title of ${new URL(url).hostname}`;
    this.emit('did-start-navigation', {}, url, false, true);
    this.emit('did-navigate', {}, url);
    return Promise.resolve();
  }
  getZoomFactor() {
    return this.zoom;
  }
  setZoomFactor(value) {
    this.zoom = value;
  }
  findInPage(text, options) {
    this.finds.push([text, options]);
  }
  stopFindInPage() {
    this.stoppedFind = true;
  }
  capturePage() {
    return Promise.resolve({ isEmpty: () => false, toJPEG: () => Buffer.from('jpeg-bytes') });
  }
  send(channel, payload) {
    this.sent.push([channel, payload]);
    if (channel === 'browser:state') this.latestState = payload;
  }
}

let viewCounter = 0;

class FakeView {
  constructor(options) {
    this.seq = ++viewCounter;
    this.options = options;
    this.webContents = new FakeContents();
    this.bounds = null;
    this.visible = true;
  }
  setBounds(bounds) {
    this.bounds = bounds;
  }
  setVisible(value) {
    this.visible = value;
  }
}

const fake = {
  windows: [],
  handlers: new Map(),
  listeners: new Map(),
  appHandlers: new Map(),
  menu: null,
  permissionRequest: null,
  permissionCheck: null,
  quitCalls: 0
};

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeContents();
    this.children = [];
    this.contentView = {
      addChildView: (view) => this.children.push(view),
      removeChildView: (view) => {
        this.children = this.children.filter((child) => child !== view);
      }
    };
    this.title = '';
    fake.windows.push(this);
  }
  removeMenu() {}
  loadFile() {
    return Promise.resolve();
  }
  getContentBounds() {
    return { width: 1280, height: 800 };
  }
  isDestroyed() {
    return false;
  }
  setTitle(title) {
    this.title = title;
  }
  setFullScreen(value) {
    this.fullScreen = value;
  }
  isFullScreen() {
    return Boolean(this.fullScreen);
  }
  static getAllWindows() {
    return fake.windows;
  }
}

const electron = {
  app: {
    setName() {},
    setAppUserModelId() {},
    setPath() {},
    getPath: () => userData,
    getAppPath: () => root,
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    quit() {
      fake.quitCalls++;
    },
    on(name, handler) {
      fake.appHandlers.set(name, handler);
    }
  },
  BrowserWindow: FakeWindow,
  WebContentsView: FakeView,
  ipcMain: {
    handle: (channel, handler) => fake.handlers.set(channel, handler),
    on: (channel, handler) => fake.listeners.set(channel, handler)
  },
  dialog: { showErrorBox() {} },
  Menu: {
    buildFromTemplate: (template) => ({
      popup() {
        fake.menu = template;
      }
    })
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (handler) => (fake.permissionRequest = handler),
      setPermissionCheckHandler: (handler) => (fake.permissionCheck = handler)
    }
  }
};

const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
};

function ui() {
  return fake.windows[0];
}
function invoke(channel, ...args) {
  const handler = fake.handlers.get(channel);
  assert.ok(handler, `no handler for ${channel}`);
  return Promise.resolve().then(() => handler({ sender: ui().webContents }, ...args));
}
function lastState() {
  return ui().webContents.latestState;
}
function sentTo(channel) {
  return ui()
    .webContents.sent.filter(([name]) => name === channel)
    .map(([, payload]) => payload);
}
function activeTabState() {
  return lastState().tabs.find((tab) => tab.id === lastState().activeTabId);
}
function viewOf(tabId) {
  return ui().children.find((child) => String(child.seq) === tabId);
}
function activeView() {
  return viewOf(lastState().activeTabId);
}
async function waitFor(check, label) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
}

before(async () => {
  require('../desktop/main.cjs');
  await waitFor(
    () =>
      fake.windows.length === 1 &&
      ui().children.length === 1 &&
      fake.handlers.has('browser:get-state'),
    'startup'
  );
});

test('the browser starts with one empty tab and secure window settings', async () => {
  const state = await invoke('browser:get-state');
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].isHome, true);
  assert.equal(state.activeTabId, state.tabs[0].id);
  const prefs = ui().options.webPreferences;
  assert.deepEqual(
    [prefs.nodeIntegration, prefs.contextIsolation, prefs.sandbox, prefs.webSecurity],
    [false, true, true, true]
  );
  const tabPrefs = ui().children[0].options.webPreferences;
  assert.deepEqual(
    [tabPrefs.nodeIntegration, tabPrefs.contextIsolation, tabPrefs.sandbox],
    [false, true, true]
  );
  assert.ok(prefs.preload.endsWith(path.join('desktop', 'preload.cjs')));
});

test('opening a page records history, a title, and updates the window title', async () => {
  await invoke('browser:navigate', 'https://docs.python.org/3/library/asyncio.html');
  const tab = lastState().tabs[0];
  assert.equal(tab.url, 'https://docs.python.org/3/library/asyncio.html');
  assert.equal(tab.isHome, false);
  assert.match(ui().title, /Title of docs.python.org — Nova Browser/);
  const history = await invoke('library:history', { query: 'asyncio' });
  assert.equal(history.length, 1);
  assert.equal(history[0].visitCount, 1);
});

test('addresses that are not web pages are refused', async () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', '']) {
    await assert.rejects(invoke('browser:navigate', bad), TypeError, bad);
  }
  await assert.rejects(invoke('browser:new-tab', 'file:///etc/passwd'), TypeError);
  await assert.rejects(invoke('browser:close-tab', 42), TypeError);
  await assert.rejects(invoke('browser:activate-tab', ''), TypeError);
  await assert.rejects(invoke('browser:cycle-tab', 5), TypeError);
  await assert.rejects(invoke('library:remove-bookmark', null), TypeError);
});

test('the star adds and removes a bookmark and shows in the tab state', async () => {
  assert.deepEqual(await invoke('library:toggle-bookmark'), { bookmarked: true });
  assert.equal(lastState().tabs[0].bookmarked, true);
  assert.equal((await invoke('library:bookmarks')).length, 1);
  assert.ok(sentTo('library:changed').includes('bookmarks'));
  const suggestions = await invoke('library:suggest', 'asyncio');
  assert.equal(suggestions[0].type, 'bookmark');
  assert.deepEqual(await invoke('library:suggest', 123), []);
  assert.deepEqual(await invoke('library:toggle-bookmark'), { bookmarked: false });
  assert.equal(lastState().tabs[0].bookmarked, false);
});

test('a new tab page cannot be bookmarked', async () => {
  const id = await invoke('browser:new-tab');
  await assert.rejects(invoke('library:toggle-bookmark'), /Open a web page first/);
  await invoke('browser:close-tab', id);
});

test('new tabs can open an address, and closed tabs can be reopened', async () => {
  const id = await invoke('browser:new-tab', 'https://example.org/page');
  assert.equal(lastState().activeTabId, id);
  assert.equal(lastState().tabs.length, 2);
  await invoke('browser:close-tab', id);
  assert.equal(lastState().tabs.length, 1);
  assert.equal(await invoke('browser:reopen-tab'), true);
  assert.equal(lastState().tabs.length, 2);
  assert.equal(lastState().tabs[1].url, 'https://example.org/page');
  assert.equal(await invoke('browser:reopen-tab'), false);
});

test('closing the active tab moves to its neighbour, and the last tab is replaced', async () => {
  const [first, second] = lastState().tabs;
  const third = await invoke('browser:new-tab', 'https://third.example/');
  await invoke('browser:activate-tab', second.id);
  await invoke('browser:close-tab', second.id);
  assert.equal(lastState().activeTabId, third);
  await invoke('browser:close-tab', third);
  assert.equal(lastState().activeTabId, first.id);
  await invoke('browser:close-tab', first.id);
  assert.equal(lastState().tabs.length, 1);
  assert.equal(lastState().tabs[0].isHome, true);
});

test('tabs can be cycled in both directions', async () => {
  const a = lastState().tabs[0].id;
  const b = await invoke('browser:new-tab');
  const c = await invoke('browser:new-tab');
  assert.equal(lastState().activeTabId, c);
  await invoke('browser:cycle-tab', 1);
  assert.equal(lastState().activeTabId, a);
  await invoke('browser:cycle-tab', -1);
  assert.equal(lastState().activeTabId, c);
  await invoke('browser:close-tab', c);
  await invoke('browser:close-tab', b);
});

test('the tab menu can pin a tab and pinned tabs stay first', async () => {
  const a = lastState().tabs[0].id;
  const b = await invoke('browser:new-tab', 'https://pin-me.example/');
  assert.equal(await invoke('browser:tab-menu', b), true);
  const labels = fake.menu.filter((item) => item.label).map((item) => item.label);
  assert.deepEqual(labels, [
    'Reload tab',
    'Pin tab',
    'Duplicate tab',
    'Close tab',
    'Close other tabs',
    'Close tabs to the right',
    'Reopen closed tab'
  ]);
  fake.menu.find((item) => item.label === 'Pin tab').click();
  assert.deepEqual(
    lastState().tabs.map((tab) => tab.id),
    [b, a]
  );
  assert.equal(lastState().tabs[0].pinned, true);
  await invoke('browser:tab-menu', b);
  assert.equal(fake.menu.find((item) => item.label === 'Unpin tab') !== undefined, true);
  fake.menu.find((item) => item.label === 'Duplicate tab').click();
  assert.equal(lastState().tabs.length, 3);
  assert.equal(lastState().tabs[1].url, 'https://pin-me.example/');
  await invoke('browser:tab-menu', a);
  fake.menu.find((item) => item.label === 'Close other tabs').click();
  assert.deepEqual(
    lastState()
      .tabs.map((tab) => tab.id)
      .sort(),
    [a, b].sort()
  );
  fake.menu.length = 0;
});

test('pages cannot change the page layout, only the window can', async () => {
  const pageView = activeView();
  const send = (sender, insets) => fake.listeners.get('browser:layout')({ sender }, insets);
  send(ui().webContents, { top: 140, left: 300, right: 0, bottom: 43 });
  assert.deepEqual(pageView.bounds, { x: 300, y: 140, width: 980, height: 617 });
  send({ other: true }, { top: 5, left: 5, right: 5, bottom: 5 });
  assert.equal(pageView.bounds.y, 140);
  send(ui().webContents, { top: 'x', left: -50, right: 99999, bottom: null });
  assert.equal(pageView.bounds.x, 0);
  assert.equal(pageView.bounds.width, 0);
  send(ui().webContents, { top: 126, left: 0, right: 0, bottom: 0 });
  assert.equal(pageView.bounds.y, 126);
});

test('opening a menu snapshots the page, hides it, and restores it afterwards', async () => {
  await invoke('browser:navigate', 'https://snapshot.example/');
  const pageView = activeView();
  ui().webContents.sent.length = 0;
  await invoke('browser:overlay', true);
  const snapshots = sentTo('browser:snapshot');
  assert.equal(snapshots.length, 1);
  assert.match(snapshots[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(pageView.visible, false);
  await invoke('browser:overlay', false);
  assert.equal(sentTo('browser:snapshot').at(-1), null);
  assert.equal(pageView.visible, true);
  assert.equal(await invoke('browser:overlay', 'yes'), true);
  await invoke('browser:overlay', false);
});

test('a snapshot that never arrives does not block the menu', async () => {
  const contents = activeView().webContents;
  const original = contents.capturePage;
  contents.capturePage = () => new Promise(() => {});
  ui().webContents.sent.length = 0;
  await invoke('browser:overlay', true);
  assert.equal(sentTo('browser:snapshot').length, 0);
  assert.equal(activeView().visible, false);
  await invoke('browser:overlay', false);
  contents.capturePage = original;
});

test('browser shortcuts pressed inside a page are passed to the interface', async () => {
  const contents = activeView().webContents;
  ui().webContents.sent.length = 0;
  const press = (input) => {
    let prevented = false;
    contents.emit(
      'before-input-event',
      { preventDefault: () => (prevented = true) },
      { type: 'keyDown', ...input }
    );
    return prevented;
  };
  assert.equal(press({ key: 't', control: true }), true);
  assert.equal(press({ key: 'T', control: true, shift: true }), true);
  assert.equal(press({ key: 'f', control: true }), true);
  assert.deepEqual(sentTo('browser:command'), ['new-tab', 'reopen-tab', 'find']);
  assert.equal(press({ key: 'b', control: true }), false);
  assert.equal(press({ key: 'k', control: true }), false);
  assert.equal(press({ key: 'a' }), false);
  assert.equal(press({ key: 'c', control: true }), false);
  assert.equal(press({ key: 't', control: true, type: 'keyUp' }), false);
  assert.equal(sentTo('browser:command').length, 3);
});

test('permission questions are sent to the interface and answered by the user', async () => {
  const contents = activeView().webContents;
  const answers = [];
  fake.permissionRequest(contents, 'geolocation', (value) => answers.push(value), {
    requestingUrl: 'https://maps.example/path'
  });
  const request = sentTo('permission:request').at(-1);
  assert.equal(request.host, 'maps.example');
  assert.equal(request.action, 'know your location');
  assert.equal(await invoke('permission:respond', request.id, true), true);
  assert.deepEqual(answers, [true]);
  assert.equal(fake.permissionCheck(contents, 'geolocation', 'https://maps.example'), true);
  fake.permissionRequest(contents, 'midi', (value) => answers.push(value), {
    requestingUrl: 'https://maps.example/'
  });
  fake.permissionRequest(ui().webContents, 'geolocation', (value) => answers.push(value), {
    requestingUrl: 'https://maps.example/'
  });
  fake.permissionRequest(contents, 'fullscreen', (value) => answers.push(value), {});
  assert.deepEqual(answers, [true, false, false, true]);
});

test('pages cannot open non-web links, redirect to them, or open windows freely', async () => {
  const contents = activeView().webContents;
  let blocked = 0;
  const event = { preventDefault: () => blocked++ };
  contents.emit('will-navigate', event, 'javascript:alert(1)');
  contents.emit('will-navigate', event, 'file:///etc/passwd');
  contents.emit('will-redirect', event, 'file:///etc/passwd');
  assert.equal(blocked, 3);
  contents.emit('will-navigate', event, 'https://fine.example/');
  assert.equal(blocked, 3);
  assert.deepEqual(contents.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  const before = lastState().tabs.length;
  assert.deepEqual(contents.openHandler({ url: 'https://popup.example/' }), { action: 'deny' });
  assert.equal(lastState().tabs.length, before + 1);
});

test('site icons are kept only when they are https images', async () => {
  const contents = activeView().webContents;
  contents.emit('page-favicon-updated', {}, [
    'http://snapshot.example/a.ico',
    'data:image/png;base64,AAAA',
    'https://snapshot.example/icon.png'
  ]);
  assert.equal(activeTabState().favicon, 'https://snapshot.example/icon.png');
  contents.emit('page-favicon-updated', {}, ['http://snapshot.example/a.ico']);
  assert.equal(activeTabState().favicon, '');
});

test('zoom, find and reload work on the active page', async () => {
  const contents = activeView().webContents;
  assert.equal(await invoke('browser:zoom', 'get'), 100);
  assert.equal(await invoke('browser:zoom', 'in'), 110);
  assert.equal(await invoke('browser:zoom', 'out'), 100);
  assert.equal(await invoke('browser:zoom', 'reset'), 100);
  await assert.rejects(invoke('browser:zoom', 'sideways'), TypeError);
  await invoke('browser:find-in-page', 'hello', { forward: false, findNext: true });
  assert.deepEqual(contents.finds.at(-1), ['hello', { forward: false, findNext: true }]);
  await invoke('browser:find-in-page', 'x'.repeat(500));
  assert.equal(contents.finds.at(-1)[0].length, 300);
  await invoke('browser:find-in-page', '   ');
  assert.equal(contents.stoppedFind, true);
  await invoke('browser:reload', false);
  assert.equal(contents.reloaded, 1);
  await invoke('browser:reload', true);
  assert.equal(contents.hardReloaded, true);
  contents.loading = true;
  await invoke('browser:reload');
  assert.equal(contents.loading, false);
});

test('going home returns the tab to the start page', async () => {
  await invoke('browser:home');
  const tab = lastState().tabs.find((item) => item.id === lastState().activeTabId);
  assert.deepEqual([tab.isHome, tab.url, tab.favicon], [true, '', '']);
  assert.equal(ui().title, 'Nova Browser');
});

test('searching without any provider gives a clear message and saves nothing', async () => {
  await assert.rejects(invoke('omni:search', 'python', 1), /No search provider/);
  await assert.rejects(invoke('omni:search', 'x'.repeat(301), 1), TypeError);
  assert.equal(
    (await invoke('library:suggest', 'python')).filter((row) => row.type === 'search').length,
    0
  );
  const status = await invoke('omni:get-search-status');
  assert.deepEqual(status.providers, []);
  await assert.rejects(invoke('omni:generate-queries', 'a'), TypeError);
});

test('history can be removed and cleared, and top sites reflect visits', async () => {
  await invoke('browser:navigate', 'https://remove-me.example/a');
  assert.ok((await invoke('library:top-sites', 5)).length > 0);
  assert.equal(await invoke('library:remove-history', 'https://remove-me.example/a'), true);
  assert.equal(await invoke('library:remove-history', 'https://remove-me.example/a'), false);
  assert.ok((await invoke('library:clear-history')) >= 1);
  assert.equal((await invoke('library:history', {})).length, 0);
  assert.ok(sentTo('library:changed').includes('all'));
});

test('the failed page message is friendly and does not show technical details', async () => {
  const contents = activeView().webContents;
  ui().webContents.sent.length = 0;
  contents.emit(
    'did-fail-load',
    {},
    -105,
    'ERR_NAME_NOT_RESOLVED',
    'https://does-not-exist.example/',
    true
  );
  const [error] = sentTo('browser:navigation-error');
  assert.equal(error.url, 'https://does-not-exist.example/');
  assert.doesNotMatch(error.message, /ERR_|NAME_NOT/);
  assert.equal(activeTabState().isHome, true);
});

test('bookmarks and history are saved before the app quits', async () => {
  await invoke('browser:navigate', 'https://saved-on-quit.example/');
  await invoke('library:toggle-bookmark');
  const handler = fake.appHandlers.get('before-quit');
  let prevented = false;
  handler({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  await waitFor(() => fake.quitCalls > 0, 'quit after saving');
  const saved = JSON.parse(await fs.readFile(path.join(userData, 'library.json'), 'utf8'));
  assert.ok(saved.bookmarks.some((item) => item.url === 'https://saved-on-quit.example/'));
  prevented = false;
  handler({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
});

test('closing the window clears everything and denies open permission questions', async () => {
  const contents = activeView().webContents;
  const answers = [];
  fake.permissionRequest(contents, 'notifications', (value) => answers.push(value), {
    requestingUrl: 'https://later.example/'
  });
  ui().emit('closed');
  assert.deepEqual(answers, [false]);
  assert.equal((await invoke('browser:get-state').catch(() => ({ tabs: [] }))).tabs.length, 0);
});
