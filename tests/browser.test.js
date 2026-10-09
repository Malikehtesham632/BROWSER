import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

test('Electron browser shell uses context isolation and disables renderer Node access', () => {
  const main = read('main.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});

test('Electron browser denies dangerous permission requests by default', () => {
  const main = read('main.cjs');
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /permission === 'fullscreen'/);
});

test('Nova updater supports check, download and install lifecycle', () => {
  const preload = read('preload.cjs');
  const main = read('main.cjs');
  assert.match(preload, /checkForUpdates/);
  assert.match(preload, /downloadUpdate/);
  assert.match(preload, /installUpdate/);
  assert.match(main, /autoDownload = false/);
  assert.match(main, /autoInstallOnAppQuit = true/);
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
