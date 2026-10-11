import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

test('Electron browser shell uses context isolation and disables renderer Node access', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});

test('audio state changes handle Electron boolean or missing payloads safely', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /contents\.on\('audio-state-changed',\s*\(_event,\s*audible\)\s*=>\s*\{/);
  assert.match(main, /typeof audible === 'boolean' \? audible : contents\.isCurrentlyAudible\(\)/);
  assert.doesNotMatch(main, /audio-state-changed',\s*\(_event,\s*\{\s*audible/);
});

test('browser preferences use validated main-process IPC and expose working settings controls', () => {
  const main = read('desktop/main.cjs');
  const preload = read('desktop/preload.cjs');
  const html = read('desktop/index.html');
  const app = read('desktop/app.js');
  assert.match(main, /ipcMain\.handle\('browser:set-preferences'/);
  assert.match(main, /typeof preferences\.restoreSession !== 'boolean'/);
  assert.match(main, /normalizeBrowserAddress\(tab\.url\)/);
  assert.match(preload, /getPreferences: \(\) => ipcRenderer\.invoke\('browser:get-preferences'\)/);
  assert.match(preload, /setPreferences: preferences => ipcRenderer\.invoke\('browser:set-preferences', preferences\)/);
  assert.match(html, /id="settings-dialog"/);
  assert.match(html, /id="restore-session"/);
  assert.match(app, /window\.omni\.setPreferences\(\{ restoreSession: checkbox\.checked \}\)/);
});

test('browser shell includes session restore, drag reordering, pinned tabs and tab shortcuts', () => {
  const main = read('desktop/main.cjs');
  const app = read('desktop/app.js');
  assert.match(main, /browserSettings\.restoreSession && browserSettings\.tabs\.length/);
  assert.match(main, /window\.on\('close', persistBrowserSession\)/);
  assert.match(main, /browser:pin-tab/);
  assert.match(app, /button\.addEventListener\('drop'/);
  assert.match(app, /window\.omni\.pinTab\(tab\.id\)/);
  assert.match(app, /key === 'tab'/);
});

test('search provider settings expose configured state and encrypt credentials in OS storage', () => {
  const main = read('desktop/main.cjs');
  const preload = read('desktop/preload.cjs');
  const html = read('desktop/index.html');
  const app = read('desktop/app.js');
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.match(main, /provider-credentials\.json/);
  assert.match(main, /providerAvailability:\s*\{/);
  assert.match(main, /serpapi:\s*Boolean\(config\.keys\.serpapi\)/);
  assert.match(preload, /saveProviderCredentials:\s*credentials => ipcRenderer\.invoke\('omni:save-provider-credentials'/);
  assert.match(html, /data-settings-page="search"/);
  assert.match(html, /id="serper-key"/);
  assert.match(html, /id="serpapi-key"/);
  assert.match(html, /id="exa-key"/);
  assert.match(html, /id="firecrawl-key"/);
  assert.match(app, /status\.providerAvailability/);
  assert.match(app, /window\.omni\.saveProviderCredentials\(credentials\)/);
});

test('browser menu reserves only its measured height instead of a fixed oversized gap', () => {
  const app = read('desktop/app.js');
  const css = read('desktop/style.css');
  assert.match(app, /browserMenu\.getBoundingClientRect\(\)\.bottom/);
  assert.match(app, /setProperty\('--menu-space'/);
  assert.match(css, /\.browser-chrome\.menu-open\s*\{\s*padding-bottom:\s*var\(--menu-space,\s*0px\)/);
  assert.doesNotMatch(css, /\.browser-chrome\.menu-open\s*\{\s*padding-bottom:\s*min\(640px/);
});

test('Electron browser denies dangerous permission requests by default', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /permission === 'fullscreen'/);
});

test('Nova updater supports check, download and install lifecycle', () => {
  const preload = read('desktop/preload.cjs');
  const main = read('desktop/main.cjs');
  assert.match(preload, /checkForUpdates/);
  assert.match(preload, /downloadUpdate/);
  assert.match(preload, /installUpdate/);
  assert.match(main, /autoDownload = false/);
  assert.match(main, /autoInstallOnAppQuit = true/);
});

test('packaged browser starts the Omni server in-process instead of spawning the Electron executable', () => {
  const pkg = JSON.parse(read('package.json'));
  const main = read('desktop/main.cjs');
  assert.equal(pkg.main, 'desktop/main.cjs');
  assert.match(main, /createSearchEngine/);
  assert.doesNotMatch(main, /spawn\(process\.execPath/);
});

test('Search stream announces the provider set before provider results', () => {
  const server = read('src/server.js');
  assert.match(server, /write\('start',\{providers:engine\.providerNames\(\)/);
  assert.match(server, /write\('provider'/);
});

test('Search UI progress no longer uses provider object-field count', () => {
  const app = read('public/app.js');
  assert.doesNotMatch(app, /Object\.keys\(data\.provider\)\.length/);
  assert.match(app, /providersTotal/);
  assert.match(app, /type==='start'/);
});
