import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const nsis = await fs.readFile(path.join(root, 'installer', 'installer.nsh'), 'utf8');

test('Windows build uses a per-user, branded assisted NSIS installer', () => {
  assert.equal(manifest.build.appId, 'com.nova.browser');
  assert.equal(manifest.build.productName, 'Nova Browser');
  assert.equal(manifest.build.win.icon, 'build/nova.ico');
  assert.equal(manifest.build.nsis.include, 'installer/installer.nsh');
  assert.equal(manifest.build.nsis.installerIcon, 'build/nova.ico');
  assert.deepEqual(manifest.build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(manifest.build.nsis.runAfterFinish, true);
});

test('installer bundles no environment secrets and keeps browser profile by default', () => {
  const packagedFiles = manifest.build.files;
  assert.ok(!packagedFiles.some((pattern) => pattern === '.env' || pattern === '**/.env'));
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
  assert.match(
    nsis,
    /Section\s+\/o\s+"Also remove Nova profile data \(preferences and site data\)"/
  );
  assert.match(nsis, /RMDir\s+\/r\s+"\$APPDATA\\Nova Browser"/);
  assert.doesNotMatch(nsis, /bookmarks/);
});

test('installer provides branded welcome, shortcut options, and actual shortcut creation', () => {
  assert.match(nsis, /Welcome to Nova Browser/);
  assert.match(nsis, /Page custom NovaOptionsPage NovaOptionsLeave/);
  assert.match(nsis, /Create a desktop shortcut/);
  assert.match(nsis, /Add Nova to the Start Menu/);
  assert.match(nsis, /CreateShortCut "\$DESKTOP\\Nova Browser\.lnk"/);
  assert.match(nsis, /CreateShortCut "\$SMPROGRAMS\\Nova Browser\\Nova Browser\.lnk"/);
  assert.match(nsis, /MUI_FINISHPAGE_TITLE "Nova Browser is ready\."/);
});
