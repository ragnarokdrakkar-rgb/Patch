const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createStorage } = require('./storage-core');
const releaseConfig = require('./release-config');
const { createRollbackManager } = require('./rollback-core');

let storage = null;
let mainWindow = null;
let updaterStarted = false;
let rollbackManager = null;
let manualUpdateCheckPending = false;
let updaterCheckInFlight = false;
let updateFlowActive = false;

// PATCH_2_0_10_SAFE_UPDATE

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
    runUpdateCheck(true);
  });

  ipcMain.on('updater:install', () => {
    if (!app.isPackaged) return;
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      logUpdater('Namestitev prenesene posodobitve ni uspela.', error);
      sendUpdaterStatus({ state: 'error', manual: true, visible: true, message: error.message || String(error) });
    }
  });

  ipcMain.on('rollback:status-sync', (event) => {
    try {
      event.returnValue = rollbackManager
        ? rollbackManager.getStatus()
        : { ok: false, error: 'Rollback modul še ni pripravljen.' };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });

  ipcMain.handle('rollback:open-folder', async () => {
    if (!rollbackManager) return { ok: false, error: 'Rollback modul še ni pripravljen.' };
    rollbackManager.createTools();
    const folder = rollbackManager.getRoot();
    const error = await shell.openPath(folder);
    return error ? { ok: false, error } : { ok: true, path: folder };
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
    logUpdater('Preverjam posodobitve v ozadju.');
  });

  autoUpdater.on('update-available', async (info) => {
    updaterCheckInFlight = false;
    const wasManual = manualUpdateCheckPending;
    manualUpdateCheckPending = false;
    const version = String(info && info.version || '');

    if (rollbackManager && rollbackManager.isBlocked(version)) {
      logUpdater(`Verzija ${version} je blokirana po rollbacku.`);
      if (wasManual) {
        sendUpdaterStatus({
          state: 'blocked',
          manual: true,
          visible: true,
          version,
          message: 'Ta verzija je bila po rollbacku označena kot pokvarjena.',
        });
      }
      return;
    }

    updateFlowActive = true;
    sendUpdaterStatus({
      state: 'available',
      visible: true,
      version,
      phase: 'rollback',
      message: 'Pripravljam varno povrnitev trenutne verzije.',
    });

    try {
      if (!rollbackManager) throw new Error('Rollback modul ni pripravljen.');
      const prepared = await rollbackManager.prepareForUpdate(version);
      logUpdater(`Rollback za ${prepared.version} je pripravljen pred nadgradnjo na ${version}.`);
      sendUpdaterStatus({
        state: 'available',
        visible: true,
        version,
        phase: 'download',
        rollbackVersion: prepared.version,
        message: `Varna povrnitev na ${prepared.version} je pripravljena. Začenjam prenos.`,
      });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      updateFlowActive = false;
      logUpdater('Posodobitev je ustavljena, ker varnega rollbacka ni bilo mogoče pripraviti.', error);
      sendUpdaterStatus({
        state: 'error',
        visible: true,
        version,
        message: 'Posodobitev ni bila prenesena, ker varnega rollbacka ni bilo mogoče pripraviti: ' + (error.message || String(error)),
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    updaterCheckInFlight = false;
    const wasManual = manualUpdateCheckPending;
    manualUpdateCheckPending = false;
    logUpdater(`Ni nove posodobitve. Trenutna/latest verzija: ${info.version}.`);
    if (wasManual) {
      sendUpdaterStatus({ state: 'not-available', manual: true, version: info.version });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(Number(progress.percent) || 0);
    logUpdater(`Prenos: ${percent} %.`);
    sendUpdaterStatus({
      state: 'downloading',
      visible: true,
      percent,
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updaterCheckInFlight = false;
    updateFlowActive = false;
    logUpdater(
      `Verzija ${info.version} je prenesena. Namestitev se izvede ob zaprtju aplikacije.`
    );
    sendUpdaterStatus({ state: 'downloaded', visible: true, version: info.version });
  });

  autoUpdater.on('error', (error) => {
    updaterCheckInFlight = false;
    const shouldShow = manualUpdateCheckPending || updateFlowActive;
    const wasManual = manualUpdateCheckPending;
    manualUpdateCheckPending = false;
    updateFlowActive = false;
    logUpdater('Napaka samodejne posodobitve.', error);
    if (shouldShow) {
      sendUpdaterStatus({
        state: 'error',
        manual: wasManual,
        visible: true,
        message: error.message || String(error),
      });
    }
  });
}

function runUpdateCheck(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      sendUpdaterStatus({
        state: 'development',
        manual: true,
        message: 'Preverjanje posodobitev deluje v nameščeni EXE različici.',
      });
    }
    return;
  }

  if (updaterCheckInFlight) {
    if (manual) sendUpdaterStatus({ state: 'checking', manual: true });
    return;
  }

  updaterCheckInFlight = true;
  manualUpdateCheckPending = Boolean(manual);
  if (manual) sendUpdaterStatus({ state: 'checking', manual: true });

  autoUpdater.checkForUpdates().catch((error) => {
    updaterCheckInFlight = false;
    const shouldShow = manualUpdateCheckPending;
    manualUpdateCheckPending = false;
    logUpdater(manual ? 'Ročno preverjanje ni uspelo.' : 'Tiho preverjanje ni uspelo.', error);
    if (shouldShow) {
      sendUpdaterStatus({
        state: 'error',
        manual: true,
        visible: true,
        message: error.message || String(error),
      });
    }
  });
}

function startUpdates() {
  if (!app.isPackaged || updaterStarted) return;
  updaterStarted = true;

  /*
   * Uporabljamo vgrajeni app-update.yml. Preverjanje je tiho; UI se prikaže
   * samo ob najdeni posodobitvi ali ob ročnem preverjanju.
   */
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  configureUpdaterEvents();
  logUpdater(`Updater zagnan. Trenutna verzija: ${app.getVersion()}.`);

  setTimeout(() => runUpdateCheck(false), 5000);
  setInterval(() => runUpdateCheck(false), 60 * 60 * 1000);
}

app.whenReady().then(() => {
  storage = createStorage(app.getPath('documents'), 'Depo Injekcije');
  try {
    rollbackManager = createRollbackManager({
      documentsPath: app.getPath('documents'),
      desktopPath: app.getPath('desktop'),
      appVersion: app.getVersion(),
      appExePath: app.getPath('exe'),
      releaseOwner: releaseConfig.owner,
      releaseRepo: releaseConfig.repo,
      storagePaths: storage.getPaths(),
      logger: logUpdater,
      keepVersions: 2,
    });
    rollbackManager.initialize();
  } catch (error) {
    rollbackManager = null;
    logUpdater('Rollback modula ni bilo mogoče inicializirati.', error);
  }
  registerIpc();
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  createWindow();
  startUpdates();

  // Prehodna varnost: 2.0.10 v ozadju pripravi tudi installer 2.0.9.
  // Od 2.0.11 naprej se vedno shrani neposredno prejšnja delujoča verzija.
  if (rollbackManager && app.isPackaged) {
    setTimeout(() => {
      rollbackManager.ensureInitialFallback('2.0.9').then((entry) => {
        logUpdater(`Začetni rollback na ${entry.version} je pripravljen.`);
        sendRenderer('rollback:changed', rollbackManager.getStatus());
      }).catch((error) => {
        logUpdater('Začetnega rollback installerja 2.0.9 ni bilo mogoče pripraviti.', error);
      });
    }, 8000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
