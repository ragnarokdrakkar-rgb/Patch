'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const STATE_SCHEMA = 1;
const DEFAULT_KEEP_VERSIONS = 2;
const MIN_INSTALLER_BYTES = 1024 * 1024;

function safeVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Neveljavna verzija: ${version || '(prazno)'}`);
  }
  return version;
}

function versionAtLeast(version, minimum) {
  const parse = (value) => String(value || '0.0.0').split(/[+-]/)[0].split('.').map((n) => Number(n) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

function atomicWriteJson(filePath, value) {
  const temp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temp, filePath);
}

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) return '';
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function downloadHttps(url, destination, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const temp = `${destination}.download`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const request = https.get(url, {
      headers: {
        'User-Agent': 'Depo-Injekcije-PSA-Rollback',
        Accept: 'application/octet-stream',
      },
    }, (response) => {
      const status = Number(response.statusCode) || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Preveč preusmeritev pri prenosu installerja.'));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        downloadHttps(nextUrl, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`Prenos installerja ni uspel (HTTP ${status}).`));
        return;
      }

      const stream = fs.createWriteStream(temp);
      response.pipe(stream);
      stream.on('finish', () => {
        stream.close(() => {
          try {
            fs.rmSync(destination, { force: true });
            fs.renameSync(temp, destination);
            resolve(destination);
          } catch (error) {
            reject(error);
          }
        });
      });
      stream.on('error', (error) => {
        fs.rmSync(temp, { force: true });
        reject(error);
      });
    });

    request.on('error', (error) => {
      fs.rmSync(temp, { force: true });
      reject(error);
    });
    request.setTimeout(120000, () => {
      request.destroy(new Error('Prenos installerja je presegel časovno omejitev.'));
    });
  });
}

function createRollbackManager(options = {}) {
  const documentsPath = String(options.documentsPath || '');
  const desktopPath = String(options.desktopPath || '');
  const appVersion = safeVersion(options.appVersion);
  const appExePath = String(options.appExePath || '');
  const releaseOwner = String(options.releaseOwner || '').trim();
  const releaseRepo = String(options.releaseRepo || '').trim();
  const storagePaths = options.storagePaths || {};
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const downloader = typeof options.downloadFile === 'function' ? options.downloadFile : downloadHttps;
  const keepVersions = Math.max(1, Number(options.keepVersions) || DEFAULT_KEEP_VERSIONS);
  const minimumInstallerBytes = Math.max(1, Number(options.minimumInstallerBytes) || MIN_INSTALLER_BYTES);

  if (!documentsPath) throw new Error('Manjka pot Dokumenti.');
  if (!releaseOwner || !releaseRepo) throw new Error('Manjka GitHub release konfiguracija.');

  const appRoot = path.join(documentsPath, 'Depo Injekcije');
  const root = path.join(appRoot, 'Rollback');
  const statePath = path.join(root, 'rollback-state.json');
  const rollbackPs1 = path.join(root, 'Depo-Rollback.ps1');
  const rollbackCmd = path.join(root, 'Depo-Rollback.cmd');
  const enablePs1 = path.join(root, 'Omogoci-Posodobitve.ps1');
  const enableCmd = path.join(root, 'Omogoci-Posodobitve.cmd');
  const desktopLauncher = desktopPath
    ? path.join(desktopPath, 'Depo Injekcije - Povrni prejsnjo verzijo.cmd')
    : '';
  let prepareQueue = Promise.resolve();

  function defaultState() {
    return {
      schemaVersion: STATE_SCHEMA,
      currentVersion: appVersion,
      blockedVersions: [],
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }

  function loadState() {
    try {
      if (!fs.existsSync(statePath)) return defaultState();
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return {
        ...defaultState(),
        ...state,
        blockedVersions: Array.isArray(state.blockedVersions)
          ? [...new Set(state.blockedVersions.map(String))]
          : [],
        entries: Array.isArray(state.entries) ? state.entries : [],
      };
    } catch (error) {
      logger('Rollback state ni veljaven; ustvarjam novega.', error);
      return defaultState();
    }
  }

  function saveState(state) {
    const normalized = {
      ...state,
      schemaVersion: STATE_SCHEMA,
      blockedVersions: [...new Set((state.blockedVersions || []).map(String))],
      entries: Array.isArray(state.entries) ? state.entries : [],
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(statePath, normalized);
    return normalized;
  }

  function installerName(version) {
    return `Depo-Injekcije-PSA-Setup-${version}.exe`;
  }

  function installerUrl(version) {
    const v = safeVersion(version);
    return `https://github.com/${encodeURIComponent(releaseOwner)}/${encodeURIComponent(releaseRepo)}/releases/download/v${encodeURIComponent(v)}/${encodeURIComponent(installerName(v))}`;
  }

  function versionFolder(version) {
    return path.join(root, safeVersion(version));
  }

  function buildRollbackPowerShell() {
    return `$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root 'rollback-state.json'

if (-not (Test-Path $statePath)) {
  Write-Host 'Rollback podatki ne obstajajo.' -ForegroundColor Red
  Read-Host 'Pritisni Enter'
  exit 1
}

$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$entries = @($state.entries | Where-Object { $_.installer -and (Test-Path -LiteralPath $_.installer) } | Sort-Object preparedAt -Descending)
if ($entries.Count -lt 1) {
  Write-Host 'Ni shranjenega installerja prejsnje verzije.' -ForegroundColor Red
  Read-Host 'Pritisni Enter'
  exit 1
}

$entry = $entries[0]
$targetVersion = [string]$entry.version
$brokenVersion = if ($entry.targetVersion) { [string]$entry.targetVersion } else { [string]$state.currentVersion }

Add-Type -AssemblyName PresentationFramework
$message = "Trenutno/pokvarjeno: $brokenVersion\`nPovrni na: $targetVersion\`n\`nPacienti in termini se ne brisejo. Pred nadaljevanjem se naredi dodatna kopija podatkov."
$result = [System.Windows.MessageBox]::Show($message, 'Depo Injekcije - varni rollback', 'YesNo', 'Warning')
if ($result -ne 'Yes') { exit 0 }

Get-Process -Name 'DepoInjekcijePSA' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

$dataRoot = Split-Path -Parent $root
$dataFile = Join-Path $dataRoot 'data.json'
if (Test-Path -LiteralPath $dataFile) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $dataFile -Destination (Join-Path $root "data-before-manual-rollback-$stamp.json") -Force
}

$blocked = @($state.blockedVersions)
if ($brokenVersion -and $brokenVersion -ne $targetVersion -and $blocked -notcontains $brokenVersion) {
  $blocked += $brokenVersion
}
$state.blockedVersions = @($blocked)
$state.currentVersion = $targetVersion
$state.lastRollbackAt = (Get-Date).ToUniversalTime().ToString('o')
$state.lastRollbackFrom = $brokenVersion
$state.lastRollbackTo = $targetVersion
$state | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host "Zaganjam installer verzije $targetVersion ..." -ForegroundColor Cyan
Start-Process -FilePath $entry.installer -Wait

try {
  if ([version]$targetVersion -lt [version]'2.0.10' -and $entry.installDir) {
    $appUpdate = Join-Path ([string]$entry.installDir) 'resources\\app-update.yml'
    $disabled = Join-Path ([string]$entry.installDir) 'resources\\app-update.rollback-disabled.yml'
    if (Test-Path -LiteralPath $appUpdate) {
      Move-Item -LiteralPath $appUpdate -Destination $disabled -Force
      Write-Host 'Samodejne posodobitve so zacasno blokirane, da se pokvarjena verzija ne namesti znova.' -ForegroundColor Yellow
      Write-Host 'Ko bo na voljo popravljena verzija, zazeni Omogoci-Posodobitve.cmd v mapi Rollback.' -ForegroundColor Yellow
    }
  }
} catch {
  Write-Host "Opozorilo: blokade app-update.yml ni bilo mogoce nastaviti: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ''
Write-Host "Rollback na $targetVersion je koncan." -ForegroundColor Green
Read-Host 'Pritisni Enter'
`;
  }

  function buildEnablePowerShell() {
    return `$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root 'rollback-state.json'
if (-not (Test-Path $statePath)) { throw 'Manjka rollback-state.json.' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$entries = @($state.entries | Sort-Object preparedAt -Descending)
$done = $false
foreach ($entry in $entries) {
  if (-not $entry.installDir) { continue }
  $disabled = Join-Path ([string]$entry.installDir) 'resources\\app-update.rollback-disabled.yml'
  $active = Join-Path ([string]$entry.installDir) 'resources\\app-update.yml'
  if (Test-Path -LiteralPath $disabled) {
    Move-Item -LiteralPath $disabled -Destination $active -Force
    $done = $true
  }
}
if ($done) {
  Write-Host 'Samodejne posodobitve so ponovno omogocene.' -ForegroundColor Green
} else {
  Write-Host 'Ni bilo najdene zacasno onemogocene konfiguracije.' -ForegroundColor Yellow
}
Read-Host 'Pritisni Enter'
`;
  }

  function createTools() {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(rollbackPs1, buildRollbackPowerShell(), 'utf8');
    fs.writeFileSync(
      rollbackCmd,
      '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Depo-Rollback.ps1"\r\n',
      'utf8'
    );
    fs.writeFileSync(enablePs1, buildEnablePowerShell(), 'utf8');
    fs.writeFileSync(
      enableCmd,
      '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Omogoci-Posodobitve.ps1"\r\n',
      'utf8'
    );

    if (desktopLauncher) {
      fs.writeFileSync(
        desktopLauncher,
        `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "${rollbackPs1.replace(/"/g, '""')}"\r\n`,
        'utf8'
      );
    }
  }

  function prune(state) {
    const entries = [...(state.entries || [])].sort((a, b) =>
      String(b.preparedAt || '').localeCompare(String(a.preparedAt || ''))
    );
    const keep = entries.slice(0, keepVersions);
    const remove = entries.slice(keepVersions);

    for (const entry of remove) {
      if (!entry || !entry.folder) continue;
      try {
        const resolved = path.resolve(entry.folder);
        if (resolved.startsWith(path.resolve(root) + path.sep)) {
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      } catch (error) {
        logger(`Stare rollback mape ni bilo mogoče odstraniti: ${entry.folder}`, error);
      }
    }
    state.entries = keep;
    return state;
  }

  async function prepareVersionNow(version, targetVersion, source = 'update') {
    const safe = safeVersion(version);
    const target = targetVersion ? safeVersion(targetVersion) : '';
    createTools();

    let state = loadState();
    const folder = versionFolder(safe);
    fs.mkdirSync(folder, { recursive: true });

    const installer = path.join(folder, installerName(safe));
    const dataBackup = copyIfExists(storagePaths.data, path.join(folder, 'data-before-update.json'));
    const lastGoodBackup = copyIfExists(storagePaths.lastGood, path.join(folder, 'data-last-good-before-update.json'));
    const deviceBackup = copyIfExists(storagePaths.deviceSettings, path.join(folder, 'device-settings-before-update.json'));

    const installDir = appExePath ? path.dirname(appExePath) : '';
    const metadata = {
      version: safe,
      targetVersion: target,
      source,
      installer,
      folder,
      dataBackup,
      lastGoodBackup,
      deviceBackup,
      installDir,
      appExePath,
      preparedAt: new Date().toISOString(),
      supportsBlockedVersions: versionAtLeast(safe, '2.0.10'),
    };
    atomicWriteJson(path.join(folder, 'rollback-info.json'), metadata);

    const installerOkay = fs.existsSync(installer) && fs.statSync(installer).size >= minimumInstallerBytes;
    if (!installerOkay) {
      fs.rmSync(installer, { force: true });
      logger(`Prenašam rollback installer ${safe}.`);
      await downloader(installerUrl(safe), installer);
      if (!fs.existsSync(installer) || fs.statSync(installer).size < minimumInstallerBytes) {
        fs.rmSync(installer, { force: true });
        throw new Error(`Preneseni installer ${safe} ni veljaven.`);
      }
    }

    state.entries = (state.entries || []).filter((entry) => String(entry.version) !== safe);
    state.entries.push(metadata);
    state.currentVersion = appVersion;
    state = prune(state);
    saveState(state);
    createTools();
    return metadata;
  }

  function prepareVersion(version, targetVersion, source = 'update') {
    const run = prepareQueue.then(
      () => prepareVersionNow(version, targetVersion, source),
      () => prepareVersionNow(version, targetVersion, source)
    );
    prepareQueue = run.catch(() => {});
    return run;
  }

  async function prepareForUpdate(targetVersion) {
    return prepareVersion(appVersion, targetVersion, 'before-update');
  }

  async function ensureInitialFallback(previousVersion) {
    const safe = safeVersion(previousVersion);
    const state = loadState();
    const existing = (state.entries || []).find((entry) =>
      String(entry.version) === safe &&
      entry.installer &&
      fs.existsSync(entry.installer)
    );
    if (existing) return existing;
    return prepareVersion(safe, appVersion, 'initial-fallback');
  }

  function initialize() {
    createTools();
    const state = loadState();
    state.currentVersion = appVersion;
    saveState(state);
    return getStatus();
  }

  function isBlocked(version) {
    const state = loadState();
    return (state.blockedVersions || []).includes(String(version));
  }

  function getStatus() {
    const state = loadState();
    const entries = (state.entries || [])
      .filter((entry) => entry && entry.installer && fs.existsSync(entry.installer))
      .sort((a, b) => String(b.preparedAt || '').localeCompare(String(a.preparedAt || '')));
    return {
      ok: true,
      root,
      currentVersion: appVersion,
      blockedVersions: state.blockedVersions || [],
      availableVersions: entries.map((entry) => ({
        version: entry.version,
        targetVersion: entry.targetVersion || '',
        preparedAt: entry.preparedAt || '',
        installer: entry.installer,
      })),
      latest: entries[0] || null,
      desktopLauncher,
    };
  }

  return {
    initialize,
    createTools,
    prepareVersion,
    prepareForUpdate,
    ensureInitialFallback,
    isBlocked,
    getStatus,
    getRoot: () => root,
    getStatePath: () => statePath,
    installerUrl,
  };
}

module.exports = {
  createRollbackManager,
  safeVersion,
  versionAtLeast,
  downloadHttps,
};
