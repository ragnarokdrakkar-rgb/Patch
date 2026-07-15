'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(pkg.version, '2.0.9');
assert.match(html, /PATCH_2_0_9_CLEAN/, 'Manjka marker čistega patcha.');
assert.doesNotMatch(html, /id="pTelefon"/, 'Telefonsko polje ne sme biti prikazano.');
assert.doesNotMatch(html, /smsBtn\s*\(/, 'SMS funkcija ne sme obstajati.');
assert.doesNotMatch(html, /href="(?:sms|tel):/, 'SMS/telefon povezave ne smejo obstajati.');
assert.match(html, /desktopUpdaterPanel/, 'Manjka vidno updater okno.');
assert.match(html, /Prenašam posodobitev/, 'Manjka prikaz napredka posodobitve.');
assert.match(html, /Zapri in namesti/, 'Manjka gumb za namestitev.');
assert.match(main, /window:refocus/, 'Main nima IPC popravka fokusa.');
assert.match(main, /mainWindow\.blur\(\)/, 'Main ne osveži Windows fokusa.');
assert.match(preload, /refocusWindow/, 'Preload nima mostu za fokus.');
assert.match(html, /_nativeDialogConfirm/, 'Native confirm nima globalnega focus guarda.');
assert.match(main, /updater:status/, 'Main ne pošilja updater statusa.');
assert.match(preload, /onUpdaterStatus/, 'Preload ne posreduje updater statusa.');
assert.match(html, /function odstraniNapacenTermin/, 'Manjka odstranitev napačnega termina.');

function extractFunctionBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, 'Ni mogoče izločiti funkcij terminov.');
  return source.slice(start, end);
}

const appointmentSource = extractFunctionBlock(
  html,
  'function getPendingInjections',
  'function openAddPacient'
);

const patient = { id: 1, zdravilo: 'Eligard', odmerek: '22.5' };
const data = {
  termini: [
    { id: 'done', pacientId: 1, ambulantaId: 'amb_koper', datum: '2026-01-01', ura: '09:00', status: 'opravljeno', tip: 'injekcija' },
    { id: 'pending-a', pacientId: 1, ambulantaId: 'amb_koper', datum: '2026-10-01', ura: '09:00', status: 'caka', tip: 'injekcija', opomba: '' },
    { id: 'pending-b', pacientId: 1, ambulantaId: 'amb_koper', datum: '2026-11-01', ura: '09:30', status: 'caka', tip: 'injekcija', opomba: '' },
  ],
};

const sandbox = {
  data,
  activeAmbulantaId: 'amb_koper',
  clinicTermini: () => data.termini,
  getNextSlot: () => ({ datum: '2026-12-15', ura: '10:00' }),
  newId: () => 'new-id',
  Number,
  Set,
};
vm.createContext(sandbox);
vm.runInContext(appointmentSource, sandbox);

const result = sandbox.reschedulePendingInjection(patient, '2026-12-15', 'test');
assert.ok(result, 'Ponovni izračun mora vrniti termin.');
const pending = data.termini.filter(t => t.pacientId === 1 && t.status === 'caka' && t.tip !== 'kontrola');
assert.equal(pending.length, 1, 'Pacient sme imeti samo en čakajoči injekcijski termin.');
assert.equal(pending[0].id, 'pending-a', 'Obstoječi termin se mora popraviti na mestu.');
assert.equal(pending[0].datum, '2026-12-15');
assert.equal(pending[0].ura, '10:00');
assert.ok(data.termini.some(t => t.id === 'done' && t.status === 'opravljeno'), 'Opravljena zgodovina mora ostati.');
assert.ok(!data.termini.some(t => t.id === 'pending-b'), 'Odvečni čakajoči dvojnik mora biti odstranjen.');

console.log('Clean patch 2.0.9 tests passed.');
