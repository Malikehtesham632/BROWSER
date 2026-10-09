const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  setTheme: theme => ipcRenderer.invoke('app:set-theme', theme === 'dark' ? 'dark' : 'light'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openExternal: url => ipcRenderer.invoke('app:open-external', url),
  onUpdate: (event, callback) => {
    const channel = `updater:${event}`;
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
