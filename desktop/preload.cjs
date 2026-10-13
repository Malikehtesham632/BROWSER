const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, mapper = (value) => value) {
  return (callback) => {
    const listener = (_event, payload) => callback(mapper(payload));
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld(
  'omni',
  Object.freeze({
    search: (query, searchId) => ipcRenderer.invoke('omni:search', query, searchId),
    generateQueries: (query) => ipcRenderer.invoke('omni:generate-queries', query),
    getSearchStatus: () => ipcRenderer.invoke('omni:get-search-status'),

    getState: () => ipcRenderer.invoke('browser:get-state'),
    newTab: (url) => ipcRenderer.invoke('browser:new-tab', url),
    closeTab: (id) => ipcRenderer.invoke('browser:close-tab', id),
    activateTab: (id) => ipcRenderer.invoke('browser:activate-tab', id),
    cycleTab: (delta) => ipcRenderer.invoke('browser:cycle-tab', delta),
    reopenTab: () => ipcRenderer.invoke('browser:reopen-tab'),
    tabMenu: (id) => ipcRenderer.invoke('browser:tab-menu', id),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    go: (direction) => ipcRenderer.invoke('browser:go', direction),
    reload: (hard) => ipcRenderer.invoke('browser:reload', hard === true),
    home: () => ipcRenderer.invoke('browser:home'),
    zoom: (action) => ipcRenderer.invoke('browser:zoom', action),
    findInPage: (query, options) => ipcRenderer.invoke('browser:find-in-page', query, options),
    stopFindInPage: () => ipcRenderer.invoke('browser:stop-find-in-page'),
    toggleFullscreen: () => ipcRenderer.invoke('browser:toggle-fullscreen'),
    exit: () => ipcRenderer.invoke('browser:exit'),
    setLayout: (insets) => ipcRenderer.send('browser:layout', insets),
    setOverlay: (open) => ipcRenderer.invoke('browser:overlay', open === true),

    bookmarks: () => ipcRenderer.invoke('library:bookmarks'),
    toggleBookmark: () => ipcRenderer.invoke('library:toggle-bookmark'),
    removeBookmark: (id) => ipcRenderer.invoke('library:remove-bookmark', id),
    history: (options) => ipcRenderer.invoke('library:history', options),
    removeHistory: (url) => ipcRenderer.invoke('library:remove-history', url),
    clearHistory: () => ipcRenderer.invoke('library:clear-history'),
    topSites: (limit) => ipcRenderer.invoke('library:top-sites', limit),
    suggest: (query) => ipcRenderer.invoke('library:suggest', query),

    respondPermission: (id, allow) => ipcRenderer.invoke('permission:respond', id, allow === true),

    onState: listen('browser:state'),
    onNavigationError: listen('browser:navigation-error'),
    onFindResult: listen('browser:find-result'),
    onSearchProgress: listen('omni:search-progress'),
    onCommand: listen('browser:command'),
    onSnapshot: listen('browser:snapshot'),
    onLibraryChanged: listen('library:changed'),
    onPermissionRequest: listen('permission:request')
  })
);
