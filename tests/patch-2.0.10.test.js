'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'electron-builder.config.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { createRollbackManager, versionAtLeast } = require('../rollback-core');

assert.equal(pkg.version, '2.0.10');
assert.match(html, /PATCH_2_0_10_SAFE_UPDATE/);
assert.match(html, /Samodejno preverjanje je popolnoma tiho/);
assert.match(html, /id="rollbackCard"/);
assert.match(html, /Povrni prejsnjo verzijo/);
assert.match(main, /autoUpdater\.autoDownload = false/);
assert.match(main, /runUpdateCheck\(false\)/);
assert.match(main, /prepareForUpdate/);
assert.match(main, /isBlocked/);
assert.match(main, /ensureInitialFallback\('2\.0\.9'\)/);
assert.match(preload, /getRollbackStatus/);
assert.match(preload, /openRollbackFolder/);
assert.match(builder, /rollback-core\.js/);
assert.doesNotMatch(main, /checkForUpdatesAndNotify/);
assert.equal(versionAtLeast('2.0.10', '2.0.10'), true);
assert.equal(versionAtLeast('2.0.9', '2.0.10'), false);

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-rollback-test-'));
  const documents = path.join(temp, 'Documents');
  const desktop = path.join(temp, 'Desktop');
  const installDir = path.join(temp, 'Installed');
  const dataRoot = path.join(documents, 'Depo Injekcije');
  fs.mkdirSync(desktop, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });

  const data = path.join(dataRoot, 'data.json');
  const lastGood = path.join(dataRoot, 'data-last-good.json');
  const deviceSettings = path.join(dataRoot, 'device-settings.json');
  fs.writeFileSync(data, '{"pacienti":[],"termini":[],"settings":{}}', 'utf8');
  fs.writeFileSync(lastGood, '{"pacienti":[],"termini":[],"settings":{}}', 'utf8');
  fs.writeFileSync(deviceSettings, '{"homeAmbulantaId":"amb_koper"}', 'utf8');

  const manager = createRollbackManager({
    documentsPath: documents,
    desktopPath: desktop,
    appVersion: '2.0.10',
    appExePath: path.join(installDir, 'DepoInjekcijePSA.exe'),
    releaseOwner: 'ragnarokdrakkar-rgb',
    releaseRepo: 'Patch',
    storagePaths: { data, lastGood, deviceSettings },
    minimumInstallerBytes: 1,
    downloadFile: async (_url, destination) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, 'fake-installer', 'utf8');
    },
  });

  manager.initialize();
  const prepared = await manager.prepareForUpdate('2.0.11');
  assert.equal(prepared.version, '2.0.10');
  assert.equal(prepared.targetVersion, '2.0.11');
  assert.ok(fs.existsSync(prepared.installer));
  assert.ok(fs.existsSync(prepared.dataBackup));
  assert.ok(fs.existsSync(prepared.deviceBackup));

  const status = manager.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.availableVersions[0].version, '2.0.10');
  assert.ok(fs.existsSync(status.desktopLauncher));
  assert.ok(fs.existsSync(path.join(status.root, 'Depo-Rollback.cmd')));

  const ps = fs.readFileSync(path.join(status.root, 'Depo-Rollback.ps1'), 'utf8');
  assert.match(ps, /blockedVersions/);
  assert.match(ps, /app-update\.rollback-disabled\.yml/);
  assert.match(ps, /data-before-manual-rollback/);

  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Patch 2.0.10 safe update tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
