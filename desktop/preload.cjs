const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omni', Object.freeze({
  search: (query, searchId) => ipcRenderer.invoke('omni:search', query, searchId),
  generateQueries: query => ipcRenderer.invoke('omni:generate-queries', query),
  getSearchStatus: () => ipcRenderer.invoke('omni:get-search-status'),
  getState: () => ipcRenderer.invoke('browser:get-state'),
  newTab: () => ipcRenderer.invoke('browser:new-tab'),
  closeTab: id => ipcRenderer.invoke('browser:close-tab', id),
  activateTab: id => ipcRenderer.invoke('browser:activate-tab', id),
  duplicateTab: id => ipcRenderer.invoke('browser:duplicate-tab', id),
  reopenClosedTab: () => ipcRenderer.invoke('browser:reopen-closed-tab'),
  moveTab: (id, index) => ipcRenderer.invoke('browser:move-tab', id, index),
  pinTab: id => ipcRenderer.invoke('browser:pin-tab', id),
  muteTab: id => ipcRenderer.invoke('browser:mute-tab', id),
  navigate: url => ipcRenderer.invoke('browser:navigate', url),
  go: direction => ipcRenderer.invoke('browser:go', direction),
  reload: () => ipcRenderer.invoke('browser:reload'),
  home: () => ipcRenderer.invoke('browser:home'),
  zoom: action => ipcRenderer.invoke('browser:zoom', action),
  findInPage: (query, direction) => ipcRenderer.invoke('browser:find-in-page', query, direction),
  stopFindInPage: () => ipcRenderer.invoke('browser:stop-find-in-page'),
  toggleFullscreen: () => ipcRenderer.invoke('browser:toggle-fullscreen'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  exit: () => ipcRenderer.invoke('browser:exit'),
  setChromeHeight: height => ipcRenderer.send('browser:chrome-height', height),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  },
  onNavigationError: callback => {
    const listener = (_event, error) => callback(error);
    ipcRenderer.on('browser:navigation-error', listener);
    return () => ipcRenderer.removeListener('browser:navigation-error', listener);
  },
  onFindResult: callback => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('browser:find-result', listener);
    return () => ipcRenderer.removeListener('browser:find-result', listener);
  },
  onSearchProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('omni:search-progress', listener);
    return () => ipcRenderer.removeListener('omni:search-progress', listener);
  },
  onFocusAddress: callback => {
    const listener = () => callback();
    ipcRenderer.on('browser:focus-address', listener);
    return () => ipcRenderer.removeListener('browser:focus-address', listener);
  },
  onOpenFind: callback => {
    const listener = () => callback();
    ipcRenderer.on('browser:open-find', listener);
    return () => ipcRenderer.removeListener('browser:open-find', listener);
  },
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  }
}));
