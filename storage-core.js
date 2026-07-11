const path = require('node:path');
const fs = require('node:fs');

const MAX_CHANGE_BACKUPS = 30;
const MAX_DAILY_BACKUPS = 90;

function createStorage(documentsPath, folderName = 'Depo Injekcije') {
  function getPaths() {
    const root = path.join(documentsPath, folderName);
    return {
      root,
      data: path.join(root, 'data.json'),
      deviceSettings: path.join(root, 'device-settings.json'),
      lastGood: path.join(root, 'data-last-good.json'),
      previous: path.join(root, 'data-previous.json'),
      temp: path.join(root, 'data-temp.json'),
      deviceTemp: path.join(root, 'device-settings-temp.json'),
      history: path.join(root, 'History'),
      daily: path.join(root, 'Backups'),
    };
  }

  function ensureDirectories() {
    const paths = getPaths();
    fs.mkdirSync(paths.root, { recursive: true });
    fs.mkdirSync(paths.history, { recursive: true });
    fs.mkdirSync(paths.daily, { recursive: true });
    return paths;
  }

  function validateData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Glavna podatkovna struktura ni veljaven objekt.');
    }
    if (!Array.isArray(value.pacienti)) throw new Error('Manjka seznam pacientov.');
    if (!Array.isArray(value.termini)) throw new Error('Manjka seznam terminov.');
    if (!value.settings || typeof value.settings !== 'object') throw new Error('Manjkajo nastavitve.');
    if (value.ambulante !== undefined && !Array.isArray(value.ambulante)) {
      throw new Error('Seznam ambulant ni veljaven.');
    }
    return value;
  }

  function validateDeviceSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Lokalne nastavitve naprave niso veljavne.');
    }
    return {
      schemaVersion: Math.max(Number(value.schemaVersion) || 1, 2),
      firstRunCompleted: Boolean(value.firstRunCompleted),
      homeAmbulantaId: value.homeAmbulantaId ? String(value.homeAmbulantaId) : '',
      homeAmbulantaName: value.homeAmbulantaName ? String(value.homeAmbulantaName).slice(0, 120) : '',
      activeAmbulantaId: value.activeAmbulantaId ? String(value.activeAmbulantaId) : '',
      deviceName: value.deviceName ? String(value.deviceName).slice(0, 100) : '',
      updatedAt: value.updatedAt ? String(value.updatedAt) : '',
    };
  }

  function readValidJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return validateData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }

  function safeTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  function writeAndSync(filePath, text) {
    const fd = fs.openSync(filePath, 'w');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  function atomicReplace(tempPath, finalPath, text) {
    writeAndSync(tempPath, text);
    JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    fs.rmSync(finalPath, { force: true });
    fs.renameSync(tempPath, finalPath);
  }

  function rotateFiles(folder, prefix, keep) {
    const files = fs.readdirSync(folder)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
      .sort()
      .reverse();
    for (const oldName of files.slice(keep)) {
      fs.rmSync(path.join(folder, oldName), { force: true });
    }
  }

  function atomicWriteData(data) {
    const paths = ensureDirectories();
    const json = JSON.stringify(validateData(data), null, 2);
    const currentText = fs.existsSync(paths.data) ? fs.readFileSync(paths.data, 'utf8') : null;

    if (currentText === json) {
      return { ok: true, savedAt: new Date().toISOString(), path: paths.data, unchanged: true };
    }

    if (currentText !== null) {
      writeAndSync(paths.previous, currentText);
      writeAndSync(path.join(paths.history, `change-${safeTimestamp()}.json`), currentText);
      rotateFiles(paths.history, 'change-', MAX_CHANGE_BACKUPS);

      const day = new Date().toISOString().slice(0, 10);
      const dailyFile = path.join(paths.daily, `backup-${day}.json`);
      if (!fs.existsSync(dailyFile)) writeAndSync(dailyFile, currentText);
      rotateFiles(paths.daily, 'backup-', MAX_DAILY_BACKUPS);
    }

    writeAndSync(paths.temp, json);
    readValidJson(paths.temp);
    fs.rmSync(paths.data, { force: true });
    fs.renameSync(paths.temp, paths.data);

    writeAndSync(paths.lastGood, json);

    const day = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(paths.daily, `backup-${day}.json`);
    if (!fs.existsSync(dailyFile)) writeAndSync(dailyFile, json);

    return { ok: true, savedAt: new Date().toISOString(), path: paths.data };
  }

  function loadDeviceSettings() {
    const paths = ensureDirectories();
    try {
      if (!fs.existsSync(paths.deviceSettings)) {
        return { ok: true, data: null, path: paths.deviceSettings };
      }
      const raw = JSON.parse(fs.readFileSync(paths.deviceSettings, 'utf8'));
      return { ok: true, data: validateDeviceSettings(raw), path: paths.deviceSettings };
    } catch (error) {
      return { ok: false, data: null, path: paths.deviceSettings, error: error.message };
    }
  }

  function saveDeviceSettings(value) {
    const paths = ensureDirectories();
    try {
      const normalized = validateDeviceSettings({ ...value, updatedAt: new Date().toISOString() });
      atomicReplace(paths.deviceTemp, paths.deviceSettings, JSON.stringify(normalized, null, 2));
      return { ok: true, data: normalized, savedAt: normalized.updatedAt, path: paths.deviceSettings };
    } catch (error) {
      return { ok: false, error: error.message, path: paths.deviceSettings };
    }
  }

  function newestJsonFiles(folder, prefix) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
      .sort()
      .reverse()
      .map((name) => path.join(folder, name));
  }

  function loadData() {
    const paths = ensureDirectories();
    const candidates = [
      { file: paths.data, label: null },
      { file: paths.lastGood, label: 'data-last-good.json' },
      { file: paths.previous, label: 'data-previous.json' },
      ...newestJsonFiles(paths.history, 'change-').map((file) => ({ file, label: path.basename(file) })),
      ...newestJsonFiles(paths.daily, 'backup-').map((file) => ({ file, label: path.basename(file) })),
    ];

    const errors = [];
    for (const candidate of candidates) {
      try {
        const data = readValidJson(candidate.file);
        if (!data) continue;
        if (candidate.label) atomicWriteData(data);
        return { ok: true, data, path: paths.data, recoveredFrom: candidate.label };
      } catch (error) {
        errors.push(`${path.basename(candidate.file)}: ${error.message}`);
      }
    }

    if (errors.length && fs.existsSync(paths.data)) {
      return { ok: false, data: null, path: paths.data, error: errors.join(' | ') };
    }
    return { ok: true, data: null, path: paths.data, recoveredFrom: null };
  }

  function clearData() {
    const paths = ensureDirectories();
    try {
      if (fs.existsSync(paths.data)) {
        fs.copyFileSync(paths.data, path.join(paths.daily, `before-reset-${safeTimestamp()}.json`));
      }
      fs.rmSync(paths.data, { force: true });
      fs.rmSync(paths.lastGood, { force: true });
      fs.rmSync(paths.previous, { force: true });
      fs.rmSync(paths.temp, { force: true });
      // device-settings.json namenoma ostane, da odstranitev ali reset baze ne pozabi računalnika.
      return { ok: true, path: paths.root };
    } catch (error) {
      return { ok: false, error: error.message, path: paths.root };
    }
  }

  return {
    getPaths,
    ensureDirectories,
    validateData,
    atomicWriteData,
    loadData,
    clearData,
    loadDeviceSettings,
    saveDeviceSettings,
  };
}

module.exports = { createStorage };
