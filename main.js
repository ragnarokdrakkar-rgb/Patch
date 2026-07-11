const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const releaseConfig = require('./release-config');
const { createStorage } = require('./storage-core');


let storage = null;

function registerIpc() {
  ipcMain.on('storage:load-sync', (event) => {
    try { event.returnValue = storage.loadData(); }
    catch (error) { event.returnValue = { ok: false, error: error.message, data: null, path: storage.getPaths().data }; }
  });

  ipcMain.on('storage:save-sync', (event, data) => {
    try { event.returnValue = storage.atomicWriteData(data); }
    catch (error) { event.returnValue = { ok: false, error: error.message, path: storage.getPaths().data }; }
  });

  ipcMain.on('storage:clear-sync', (event) => {
    event.returnValue = storage.clearData();
  });

  ipcMain.on('storage:path-sync', (event) => {
    event.returnValue = storage.ensureDirectories().data;
  });

  ipcMain.on('app:version-sync', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on('device-settings:load-sync', (event) => {
    event.returnValue = storage.loadDeviceSettings();
  });

  ipcMain.on('device-settings:save-sync', (event, value) => {
    event.returnValue = storage.saveDeviceSettings(value);
  });

  ipcMain.handle('storage:open-folder', async () => {
    const paths = storage.ensureDirectories();
    const error = await shell.openPath(paths.root);
    return error ? { ok: false, error } : { ok: true, path: paths.root };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f1ec',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
}

function readUpdateConfig() {
  const fallback = {
    owner: String(releaseConfig.owner || '').trim(),
    repo: String(releaseConfig.repo || '').trim(),
  };
  try {
    const file = path.join(app.getPath('documents'), 'Depo Injekcije', 'update-config.json');
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      owner: String(parsed.owner || fallback.owner || '').trim(),
      repo: String(parsed.repo || fallback.repo || '').trim(),
    };
  } catch (error) {
    console.warn('update-config.json ni veljaven:', error.message);
    return fallback;
  }
}

function startUpdates() {
  if (!app.isPackaged) return;
  const { owner, repo } = readUpdateConfig();
  if (!owner || !repo || owner === 'CHANGE_ME' || repo === 'CHANGE_ME') {
    console.warn('Samodejne posodobitve niso vključene: nastavi update-config.json ali release-config.js.');
    return;
  }

  autoUpdater.setFeedURL({ provider: 'github', owner, repo });
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.warn('Preverjanje posodobitev ni uspelo:', error.message);
  });

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.warn('Preverjanje posodobitev ni uspelo:', error.message);
    });
  }, 60 * 60 * 1000);
}

app.whenReady().then(() => {
  storage = createStorage(app.getPath('documents'), 'Depo Injekcije');
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  startUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
