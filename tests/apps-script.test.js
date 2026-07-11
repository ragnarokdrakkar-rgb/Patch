const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function colToNum(col) {
  let n = 0;
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

class Range {
  constructor(sheet, row, col, rows = 1, cols = 1) {
    this.sheet = sheet; this.row = row; this.col = col; this.rows = rows; this.cols = cols;
  }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.sheet.get(this.row + r, this.col + c)));
  }
  setValues(values) {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, values[r][c]);
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, '');
    return this;
  }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); }
  key(r, c) { return `${r}:${c}`; }
  get(r, c) { return this.cells.has(this.key(r, c)) ? this.cells.get(this.key(r, c)) : ''; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), v); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      if (!m) throw new Error(`Unsupported A1: ${a}`);
      return new Range(this, Number(m[2]), colToNum(m[1]));
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getLastRow() {
    let max = 0;
    for (const key of this.cells.keys()) max = Math.max(max, Number(key.split(':')[0]));
    return max;
  }
  appendRow(values) { const row = this.getLastRow() + 1; values.forEach((v, i) => this.set(row, i + 1, v)); }
  clear() { this.cells.clear(); }
  setFrozenRows() {}
  deleteRows(start, count) {
    const next = new Map();
    for (const [key, value] of this.cells.entries()) {
      const [r, c] = key.split(':').map(Number);
      if (r >= start && r < start + count) continue;
      const nr = r >= start + count ? r - count : r;
      next.set(`${nr}:${c}`, value);
    }
    this.cells = next;
  }
}

class Spreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sh = new Sheet(name); this.sheets.set(name, sh); return sh; }
}

class TextOutput {
  constructor(text) { this.text = text; }
  setMimeType() { return this; }
  getContent() { return this.text; }
}

const spreadsheet = new Spreadsheet();
const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  isFinite,
  isNaN,
  parseInt,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => new TextOutput(text),
  },
};
vm.createContext(context);
const gs = fs.readFileSync(path.join(__dirname, '..', 'Koda.gs'), 'utf8');
vm.runInContext(gs, context, { filename: 'Koda.gs' });

function post(body) {
  const out = context.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
  return JSON.parse(out.getContent());
}
function get(params) {
  const out = context.doGet({ parameter: params });
  return JSON.parse(out.getContent());
}
function clinicPayload(id, name, patients, terms, stock = {}) {
  return {
    schemaVersion: 7,
    pacienti: patients,
    termini: terms,
    ambulante: [{ id, name, active: true, settings: { ordinacija: name, start: '09:00', end: '11:00', slotDuration: 30, maxPacientov: 5, workDays: [1,2,3,4,5] }, zaloge: stock, zalogeLog: [] }],
    zdravila: [{ ime: 'Eligard', odmerek: '22.5', enota: 'mg', intervalDni: 90 }],
    nextId: 10,
    settings: { ordinacija: name },
  };
}

// 1) Ljubljana
const ljPatient = { id: 1, ime: 'Janez', priimek: 'Novak', maticni: 'MI-1', primarnaAmbulantaId: 'amb_ljubljana', status: 'aktiven', psa: [{ datum: '2026-01-01', vrednost: 1.2 }], premestitve: [] };
const ljTerm = { id: 't_lj_1', pacientId: 1, ambulantaId: 'amb_ljubljana', datum: '2026-01-10', ura: '09:00', status: 'opravljeno', tip: 'injekcija' };
let r = post({ action: 'saveClinic', clinicId: 'amb_ljubljana', baseRevision: 0, deviceName: 'LJ PC', payload: clinicPayload('amb_ljubljana', 'Ljubljana', [ljPatient], [ljTerm], { 'Eligard||22.5': 8 }) });
assert.equal(r.ok, true);
assert.equal(r.clinicRevision, 1);

// 2) Koper z namerno enakim lokalnim patient ID-jem; strežnik ga mora premapirati.
const kpPatient = { id: 1, ime: 'Ana', priimek: 'Kralj', maticni: 'MI-2', primarnaAmbulantaId: 'amb_koper', status: 'aktiven', psa: [], premestitve: [] };
const kpTerm = { id: 't_kp_1', pacientId: 1, ambulantaId: 'amb_koper', datum: '2026-02-10', ura: '09:00', status: 'caka', tip: 'injekcija' };
r = post({ action: 'saveClinic', clinicId: 'amb_koper', baseRevision: 0, deviceName: 'KP PC', payload: clinicPayload('amb_koper', 'Koper', [kpPatient], [kpTerm], { 'Eligard||22.5': 3 }) });
assert.equal(r.ok, true);
assert.ok(r.idMap['1'] > 1, 'Koprski ID mora biti premapiran zaradi kolizije.');

let lj = get({ action: 'loadClinic', clinicId: 'amb_ljubljana' });
let kp = get({ action: 'loadClinic', clinicId: 'amb_koper' });
assert.equal(JSON.parse(lj.data).pacienti.length, 1);
assert.equal(JSON.parse(kp.data).pacienti.length, 1);
assert.equal(JSON.parse(lj.data).pacienti[0].ime, 'Janez');
assert.equal(JSON.parse(kp.data).pacienti[0].ime, 'Ana');
assert.equal(JSON.parse(lj.data).ambulante.find(a => a.id === 'amb_koper').zaloge['Eligard||22.5'], 3);

// 3) Koper spremeni samo svojo zalogo; Ljubljana mora ostati 8.
let kpSnapshot = JSON.parse(kp.data);
kpSnapshot.ambulante.find(a => a.id === 'amb_koper').zaloge['Eligard||22.5'] = 2;
r = post({ action: 'saveClinic', clinicId: 'amb_koper', baseRevision: kp.clinicRevision, deviceName: 'KP PC', payload: { ...kpSnapshot, ambulante: [kpSnapshot.ambulante.find(a => a.id === 'amb_koper')] } });
assert.equal(r.ok, true);
lj = get({ action: 'loadClinic', clinicId: 'amb_ljubljana' });
assert.equal(JSON.parse(lj.data).ambulante.find(a => a.id === 'amb_ljubljana').zaloge['Eligard||22.5'], 8);
assert.equal(JSON.parse(lj.data).ambulante.find(a => a.id === 'amb_koper').zaloge['Eligard||22.5'], 2);

// 4) Zastarela koprska revizija mora biti zavrnjena.
r = post({ action: 'saveClinic', clinicId: 'amb_koper', baseRevision: 0, deviceName: 'stari KP PC', payload: clinicPayload('amb_koper', 'Koper', [], [], {}) });
assert.equal(r.ok, false);
assert.equal(r.conflict, true);

// 5) Premestitev Janeza Ljubljana -> Koper.
lj = get({ action: 'loadClinic', clinicId: 'amb_ljubljana' });
r = post({ action: 'requestTransfer', patientId: 1, fromClinicId: 'amb_ljubljana', toClinicId: 'amb_koper', reason: 'Nadaljevanje v Kopru', baseRevision: lj.clinicRevision, deviceName: 'LJ PC' });
assert.equal(r.ok, true);
const requestId = r.request.id;
kp = get({ action: 'loadClinic', clinicId: 'amb_koper' });
assert.equal(JSON.parse(kp.data).transferRequests.length, 1);
r = post({ action: 'acceptTransfer', requestId, clinicId: 'amb_koper', baseRevision: kp.clinicRevision, deviceName: 'KP PC' });
assert.equal(r.ok, true);
kpSnapshot = JSON.parse(r.data);
assert.equal(kpSnapshot.pacienti.some(p => p.maticni === 'MI-1'), true);
assert.equal(kpSnapshot.termini.some(t => t.id === 't_lj_1'), true, 'Preneseni pacient mora dobiti staro zgodovino termina.');
assert.equal(kpSnapshot.pacienti.find(p => p.maticni === 'MI-1').psa.length, 1);

// 6) Izvorna ambulanta po novem shranjevanju ne sme izbrisati starega zgodovinskega termina.
lj = get({ action: 'loadClinic', clinicId: 'amb_ljubljana' });
const ljAfter = JSON.parse(lj.data);
assert.equal(ljAfter.pacienti.some(p => p.maticni === 'MI-1'), false);
assert.equal(ljAfter.termini.some(t => t.id === 't_lj_1'), true);
r = post({ action: 'saveClinic', clinicId: 'amb_ljubljana', baseRevision: lj.clinicRevision, deviceName: 'LJ PC', payload: { ...ljAfter, ambulante: [ljAfter.ambulante.find(a => a.id === 'amb_ljubljana')] } });
assert.equal(r.ok, true);
const central = context.readState_();
assert.equal(central.termini.some(t => t.id === 't_lj_1'), true, 'Zgodovinski termin se po premestitvi ne sme izbrisati.');
assert.equal(central.pacienti.find(p => p.maticni === 'MI-1').primarnaAmbulantaId, 'amb_koper');

console.log('Apps Script integration tests passed.');
