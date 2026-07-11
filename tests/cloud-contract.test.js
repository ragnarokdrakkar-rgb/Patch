const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(root, 'Koda.gs'), 'utf8');

// Parse Apps Script as JavaScript. Runtime globals are intentionally not executed.
assert.doesNotThrow(() => new Function(gs), 'Koda.gs ima sintaktično napako.');

assert.match(gs, /PROTOCOL_VERSION\s*=\s*7/, 'Apps Script ni protokol v7.');
assert.match(gs, /LockService\.getScriptLock/, 'Apps Script nima strežniškega zaklepa.');
assert.match(gs, /function saveClinic_/, 'Manjka ločeno shranjevanje ambulante.');
assert.match(gs, /baseRevision/, 'Manjka preverjanje revizije.');
assert.match(gs, /function requestTransfer_/, 'Manjka zahteva za premestitev.');
assert.match(gs, /function acceptTransfer_/, 'Manjka sprejem premestitve.');
assert.match(gs, /function buildClinicSnapshot_/, 'Manjka filtriran ambulantni snapshot.');
assert.match(gs, /legacySaveRejected_/, 'Stari nevarni full-save mora biti blokiran.');

assert.match(html, /CLOUD_PROTOCOL=7/, 'Aplikacija ne uporablja protokola v7.');
assert.match(html, /cloudRequest\('saveClinic'/, 'Aplikacija ne shranjuje ambulantnega dela.');
assert.match(html, /action=listClinics/, 'Aplikacija ne zna prebrati seznama ambulant.');
assert.match(html, /action=loadClinic/, 'Aplikacija ne nalaga filtrirane ambulante.');
assert.match(html, /confirmPatientTransfer/, 'Manjka uporabniški tok premestitve.');
assert.match(html, /acceptPatientTransfer/, 'Manjka sprejem pacienta.');
assert.match(html, /isReadOnlyClinic/, 'Manjka način samo za ogled druge ambulante.');
assert.match(html, /async function switchAmbulanta/, 'Preklop ambulante mora podpirati nalaganje iz oblaka.');
assert.match(html, /cloudPull\(\{clinicId:id,force:true,targetClinicId:id/, 'Preklop ne nalaga izbrane ambulante.');
assert.match(html, /opts\.clinicId\|\|homeAmbulantaId/, 'Cloud pull ne podpira izbranega clinicId.');
assert.match(html, /targetClinicId/, 'Oddaljeni snapshot ne izbere zahtevane ambulante.');

console.log('Cloud v7 contract tests passed.');
