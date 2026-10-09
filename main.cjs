const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = Number(process.env.OMNI_DESKTOP_PORT || 8787);
const HOST = '127.0.0.1';
let mainWindow;
let engineProcess;

function sendUpdate(event, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`updater:${event}`, payload);
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-available', info => sendUpdate('available', { version: info.version, releaseDate: info.releaseDate }));
  autoUpdater.on('update-not-available', info => sendUpdate('not-available', { version: info.version }));
  autoUpdater.on('download-progress', info => sendUpdate('progress', { percent: info.percent, transferred: info.transferred, total: info.total, bytesPerSecond: info.bytesPerSecond }));
  autoUpdater.on('update-downloaded', info => sendUpdate('downloaded', { version: info.version }));
  autoUpdater.on('error', error => sendUpdate('error', { message: error?.message || 'Update check failed' }));
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return { state: 'dev', message: 'Updates are checked from installed Nova Browser builds.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { state: result?.updateInfo ? 'checked' : 'unknown', version: result?.updateInfo?.version };
  } catch (error) {
    sendUpdate('error', { message: error?.message || 'Update check failed' });
    return { state: 'error', message: error?.message || 'Update check failed' };
  }
}

function startEngine() {
  const entry = path.join(app.getAppPath(), 'src', 'server.js');
  const dataDir = path.join(app.getPath('userData'), 'data');
  const env = {
    ...process.env,
    HOST,
    PORT: String(PORT),
    OMNI_INDEX_FILE: path.join(dataDir, 'omni-index.json'),
    OMNI_FRONTIER_FILE: path.join(dataDir, 'crawl-frontier.json'),
    GEMINI_CACHE_FILE: path.join(dataDir, 'gemini-query-cache.json'),
    OMNI_QUERY_CORPUS_FILE: path.join(dataDir, 'query-corpus.json')
  };
  engineProcess = spawn(process.execPath, [entry], { cwd: app.getAppPath(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  engineProcess.stdout.on('data', data => console.log(`[Omni] ${data}`));
  engineProcess.stderr.on('data', data => console.error(`[Omni] ${data}`));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    title: 'Nova Browser',
    backgroundColor: '#1c1b22',
    // Tabs live in the title bar (Firefox-style); native window buttons are drawn as an overlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1c1b22', symbolColor: '#fbfbfe', height: 44 },
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'fullscreen');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'fullscreen');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) return { action: 'allow' };
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://${HOST}:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('updater:check', () => checkForUpdates());
ipcMain.handle('updater:download', async () => {
  await autoUpdater.downloadUpdate();
  return { ok: true };
});
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:set-theme', (_event, theme) => {
  const dark = theme === 'dark';
  const colors = dark ? { color: '#1c1b22', symbolColor: '#fbfbfe' } : { color: '#f0f0f4', symbolColor: '#15141a' };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(colors.color);
    if (typeof mainWindow.setTitleBarOverlay === 'function' && process.platform !== 'darwin') {
      try { mainWindow.setTitleBarOverlay({ ...colors, height: 44 }); } catch { /* overlay unavailable */ }
    }
  }
  return true;
});
ipcMain.handle('app:open-external', (_event, url) => {
  if (/^https?:\/\//i.test(String(url))) return shell.openExternal(url);
  return false;
});

app.whenReady().then(async () => {
  configureUpdater();
  startEngine();
  await new Promise(resolve => setTimeout(resolve, 500));
  createWindow();
  if (app.isPackaged) setTimeout(() => checkForUpdates(), 2500);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (engineProcess && !engineProcess.killed) engineProcess.kill(); });
