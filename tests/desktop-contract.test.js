import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const desktop = path.resolve(import.meta.dirname, '../desktop');
const read = (file) => fs.readFileSync(path.join(desktop, file), 'utf8');
const preload = read('preload.cjs');
const main = read('main.cjs');
const html = read('index.html');
const rendererFiles = fs
  .readdirSync(desktop)
  .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'));
const rendererSource = rendererFiles.map((file) => read(file)).join('\n');

function exposedMethods() {
  const body = preload.slice(preload.indexOf('Object.freeze({'));
  return new Set([...body.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]));
}

test('every interface call used by the screens exists in the preload bridge', () => {
  const exposed = exposedMethods();
  const used = new Set([...rendererSource.matchAll(/\bapi\??\.(\w+)/g)].map((match) => match[1]));
  const missing = [...used].filter((name) => !exposed.has(name));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 25);
});

test('every request the preload sends has a handler in the main process', () => {
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]);
  const sent = [...preload.matchAll(/ipcRenderer\.send\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(invoked.length > 25);
  for (const channel of invoked)
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`), channel);
  for (const channel of sent)
    assert.match(main, new RegExp(`ipcMain\\.on\\('${channel}'`), channel);
});

test('every event the preload listens to is sent by the main process', () => {
  const listened = [...preload.matchAll(/listen\('([^']+)'/g)].map((match) => match[1]);
  assert.equal(listened.length, 8);
  for (const channel of listened) {
    const sentByMain = main.includes(`'${channel}'`) || main.includes(`"${channel}"`);
    assert.ok(sentByMain, `${channel} is never sent`);
  }
});

test('the preload exposes only the fixed list of methods and gives no raw access', () => {
  assert.doesNotMatch(preload, /exposeInMainWorld\(\s*'omni',\s*ipcRenderer/);
  assert.doesNotMatch(preload, /require\('node:(fs|child_process|path)'\)/);
  assert.match(preload, /Object\.freeze/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\(\s*'omni'/);
});

test('every element the scripts look up by id exists in the page', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const wanted = new Set([...rendererSource.matchAll(/\$\('#([\w-]+)'/g)].map((match) => match[1]));
  const missing = [...wanted].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
  assert.ok(wanted.size > 60);
});

test('the page follows its own content security policy', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son\w+="/);
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
  assert.equal(inlineScripts.length, 0);
  assert.doesNotMatch(
    rendererSource,
    /\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/
  );
  assert.doesNotMatch(rendererSource, /setAttribute\(\s*['"]style['"]/);
});

test('every screen module is loaded and every imported file exists', () => {
  assert.match(html, /<script type="module" src="\.\/app\.js">/);
  for (const file of rendererFiles) {
    for (const match of read(file).matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      assert.ok(fs.existsSync(path.join(desktop, match[1])), `${file} imports missing ${match[1]}`);
    }
  }
  for (const sheet of html.matchAll(/href="\.\/([\w-]+\.css)"/g)) {
    assert.ok(fs.existsSync(path.join(desktop, sheet[1])), sheet[1]);
  }
});

test('every menu action and keyboard command has a handler', () => {
  const app = read('app.js');
  const actions = [...html.matchAll(/data-menu-action="([\w-]+)"/g)].map((match) => match[1]);
  for (const action of actions) {
    const known = ['shortcuts'].includes(action) || app.includes(`case '${action}'`);
    assert.ok(known, `menu action ${action} is not handled`);
  }
  const shortcuts = read('shortcuts.js');
  const commands = new Set([...shortcuts.matchAll(/return '([\w-]+)'/g)].map((match) => match[1]));
  for (const command of commands) {
    const known = /^tab-/.test(command) || app.includes(`case '${command}'`);
    assert.ok(known, `command ${command} is not handled`);
  }
});

test('the app package includes every new screen file', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, '../package.json'), 'utf8'));
  assert.ok(pkg.build.files.some((pattern) => pattern.startsWith('desktop/')));
  const patterns = pkg.build.files.join(' ');
  assert.match(patterns, /desktop\/\*\*/);
});
