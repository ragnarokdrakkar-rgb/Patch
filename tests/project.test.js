const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const gs = fs.readFileSync(path.join(root, 'Koda.gs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(html, /id="modalFirstRun"/, 'Manjka čarovnik prvega zagona.');
assert.match(html, /id="firstClinicName"/, 'Manjka ime ambulante.');
assert.match(html, /id="firstStart"/, 'Manjka začetek ambulante.');
assert.match(html, /id="firstEnd"/, 'Manjka konec ambulante.');
assert.match(html, /id="firstSlotDuration"/, 'Manjka interval terminov.');
assert.match(html, /id="firstMaxPatients"/, 'Manjka dnevna kapaciteta.');
assert.match(html, /deviceSettings/, 'Manjkajo lokalne nastavitve računalnika.');
assert.match(html, /data\.ambulante/, 'Manjka večambulantna podatkovna struktura.');
assert.match(html, /window\.desktopStorage\.save/, 'HTML ne uporablja lokalnega diskovnega shranjevanja.');
assert.doesNotMatch(html, /\bloadDemo\s*\(\s*\)\s*;/, 'Demo podatki se ne smejo samodejno naložiti.');

assert.match(main, /app\.getPath\('documents'\)/, 'Podatkovna mapa ni vezana na Dokumente.');
assert.match(main, /createStorage/, 'Main proces ne uporablja storage-core.');
assert.match(preload, /storage:save-sync/, 'Preload nima sinhronega save mostu.');
assert.equal(pkg.main, 'main.js');
assert.ok(pkg.scripts.make, 'Manjka make ukaz.');
assert.ok(fs.existsSync(path.join(root, 'electron-builder.config.js')), 'Manjka electron-builder konfiguracija.');
assert.ok(pkg.scripts.publish, 'Manjka publish ukaz.');
assert.match(
  pkg.version,
  /^\d+\.\d+\.\d+$/,
  'package.json nima veljavne verzije.'
);
assert.match(gs, /PROTOCOL_VERSION = 7/, 'Manjka Apps Script v7.');
assert.match(html, /preferHome:true/, 'Začetna sinhronizacija mora odpreti domačo ambulanto.');
assert.match(html, /Izberi domačo ambulanto/, 'Manjka varna obnova napačnega lokalnega ID-ja ambulante.');
assert.match(html, /repairHomeClinicFromDirectory/, 'Manjka samodejna preslikava starega ID-ja domače ambulante.');
assert.match(html, /homeAmbulantaName/, 'Lokalne nastavitve ne hranijo imena domače ambulante.');
assert.match(main, /update-config\.json/, 'Main proces ne podpira lokalne bootstrap konfiguracije posodobitev.');

console.log('Project structure tests passed.');
