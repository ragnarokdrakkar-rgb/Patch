const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../storage-core');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'depo-storage-test-'));
const storage = createStorage(temp, 'Depo Test');

const first = {
  schemaVersion: 7,
  pacienti: [{ id: 1, ime: 'Test', priimek: 'Pacient', primarnaAmbulantaId: 'amb_lj' }],
  termini: [],
  settings: {},
  ambulante: [{ id: 'amb_lj', name: 'Ljubljana', settings: {}, zaloge: {}, zalogeLog: [] }],
  zdravila: [],
  zaloge: {},
  zalogeLog: [],
  nextId: 2,
};
const second = JSON.parse(JSON.stringify(first));
second.pacienti.push({ id: 2, ime: 'Drugi', priimek: 'Pacient', primarnaAmbulantaId: 'amb_lj' });
second.nextId = 3;

assert.equal(storage.atomicWriteData(first).ok, true);
assert.deepEqual(storage.loadData().data, first);
assert.equal(storage.atomicWriteData(second).ok, true);
assert.deepEqual(storage.loadData().data, second);

const paths = storage.getPaths();
assert.deepEqual(JSON.parse(fs.readFileSync(paths.previous, 'utf8')), first);
assert.deepEqual(JSON.parse(fs.readFileSync(paths.lastGood, 'utf8')), second);
assert.equal(fs.readdirSync(paths.history).length, 1);

const device = {
  schemaVersion: 1,
  firstRunCompleted: true,
  homeAmbulantaId: 'amb_lj',
  activeAmbulantaId: 'amb_kp',
  deviceName: 'Ljubljana PC 1',
};
const savedDevice = storage.saveDeviceSettings(device);
assert.equal(savedDevice.ok, true);
assert.equal(storage.loadDeviceSettings().data.homeAmbulantaId, 'amb_lj');
assert.equal(storage.loadDeviceSettings().data.activeAmbulantaId, 'amb_kp');
assert.equal(storage.loadDeviceSettings().data.deviceName, 'Ljubljana PC 1');

// Poškodovana glavna datoteka se mora obnoviti iz data-last-good.json.
fs.writeFileSync(paths.data, '{broken');
const recovered = storage.loadData();
assert.equal(recovered.ok, true);
assert.equal(recovered.recoveredFrom, 'data-last-good.json');
assert.deepEqual(recovered.data, second);
assert.deepEqual(JSON.parse(fs.readFileSync(paths.data, 'utf8')), second);

// Reset baze ne sme izbrisati lokalne izbire ambulante.
assert.equal(storage.clearData().ok, true);
assert.equal(fs.existsSync(paths.deviceSettings), true);
assert.equal(storage.loadDeviceSettings().data.homeAmbulantaId, 'amb_lj');

console.log('Storage tests passed:', temp);
