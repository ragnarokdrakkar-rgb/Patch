const releaseConfig = require('./release-config');

const owner = String(releaseConfig.owner || '').trim();
const repo = String(releaseConfig.repo || '').trim();
const githubConfigured = owner && repo && owner !== 'CHANGE_ME' && repo !== 'CHANGE_ME';

module.exports = {
  appId: 'si.kemaljazavac.depoinjekcijepsa',
  productName: 'Depo Injekcije PSA',
  copyright: 'Copyright © Kemal Jazavac',
  asar: true,
  npmRebuild: false,
  compression: 'normal',
  directories: {
    output: 'dist',
    buildResources: 'assets'
  },
  files: [
    'index.html',
    'main.js',
    'preload.js',
    'storage-core.js',
    'release-config.js',
    'package.json',
    'assets/**/*'
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/app-icon.ico',
    executableName: 'DepoInjekcijePSA',
    artifactName: 'Depo-Injekcije-PSA-Setup-${version}.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Depo Injekcije PSA',
    uninstallDisplayName: 'Depo Injekcije PSA',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true
  },
  publish: githubConfigured ? [{
    provider: 'github',
    owner,
    repo,
    releaseType: 'release'
  }] : null
};
