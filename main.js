const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createStorage } = require('./storage-core');

let storage = null;
let mainWindow = null;
let updaterStarted = false;

// PATCH_2_0_9_CLEAN: skupni most za fokus in vidni updater
function sendRenderer(channel, payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  } catch (_) {}
}

function sendUpdaterStatus(status) {
  sendRenderer('updater:status', {
    currentVersion: app.getVersion(),
    timestamp: new Date().toISOString(),
    ...status,
  });
}

function refocusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const restore = () => {
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus();
      }
    } catch (_) {}
  };

  // Chromium/Electron na Windows lahko po native confirm/alert/prompt izgubi fokus.
  if (process.platform === 'win32') {
    try { mainWindow.blur(); } catch (_) {}
    setTimeout(restore, 25);
    setTimeout(restore, 140);
  } else {
    restore();
  }
}

function updaterLogPath() {
  return path.join(app.getPath('documents'), 'Depo Injekcije', 'updater.log');
}

function logUpdater(message, error) {
  try {
    const file = updaterLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const detail = error && (error.stack || error.message || String(error));
    fs.appendFileSync(
      file,
      `[${new Date().toISOString()}] ${message}${detail ? ` | ${detail}` : ''}\n`,
      'utf8'
    );
  } catch (_) {}
}

function registerIpc() {
  ipcMain.on('storage:load-sync', (event) => {
    try { event.returnValue = storage.loadData(); }
    catch (error) {
      event.returnValue = {
        ok: false,
        error: error.message,
        data: null,
        path: storage.getPaths().data,
      };
    }
  });

  ipcMain.on('storage:save-sync', (event, data) => {
    try { event.returnValue = storage.atomicWriteData(data); }
    catch (error) {
      event.returnValue = {
        ok: false,
        error: error.message,
        path: storage.getPaths().data,
      };
    }
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

  ipcMain.on('window:refocus', () => {
    refocusMainWindow();
  });

  ipcMain.on('updater:check', () => {
    if (!app.isPackaged) {
      sendUpdaterStatus({
        state: 'development',
        message: 'Preverjanje posodobitev deluje v nameščeni EXE različici.',
      });
      return;
    }
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      logUpdater('Ročno preverjanje ni uspelo.', error);
      sendUpdaterStatus({ state: 'error', message: error.message || String(error) });
    });
  });

  ipcMain.on('updater:install', () => {
    if (!app.isPackaged) return;
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      logUpdater('Namestitev prenesene posodobitve ni uspela.', error);
      sendUpdaterStatus({ state: 'error', message: error.message || String(error) });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', () => {
    sendUpdaterStatus({ state: 'idle' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function configureUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    logUpdater('Preverjam posodobitve.');
    sendUpdaterStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    logUpdater(`Na voljo je verzija ${info.version}.`);
    sendUpdaterStatus({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    logUpdater(`Ni nove posodobitve. Trenutna/latest verzija: ${info.version}.`);
    sendUpdaterStatus({ state: 'not-available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(Number(progress.percent) || 0);
    logUpdater(`Prenos: ${percent} %.`);
    sendUpdaterStatus({
      state: 'downloading',
      percent,
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logUpdater(
      `Verzija ${info.version} je prenesena. Namestitev se izvede ob zaprtju aplikacije.`
    );
    sendUpdaterStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    logUpdater('Napaka samodejne posodobitve.', error);
    sendUpdaterStatus({ state: 'error', message: error.message || String(error) });
  });
}

function startUpdates() {
  if (!app.isPackaged || updaterStarted) return;
  updaterStarted = true;

  /*
   * Ne uporabljamo rocne nastavitve URL-ja za posodobitve.
   * electron-builder v installer vgradi app-update.yml s pravilnim GitHub
   * repozitorijem. Ročni setFeedURL lahko to konfiguracijo prepiše.
   */
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  configureUpdaterEvents();
  logUpdater(`Updater zagnan. Trenutna verzija: ${app.getVersion()}.`);

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      logUpdater('Začetno preverjanje ni uspelo.', error);
    });
  }, 5000);

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      logUpdater('Periodično preverjanje ni uspelo.', error);
    });
  }, 60 * 60 * 1000);
}

app.whenReady().then(() => {
  storage = createStorage(app.getPath('documents'), 'Depo Injekcije');
  registerIpc();
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  createWindow();
  startUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
