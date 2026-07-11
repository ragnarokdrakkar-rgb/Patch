/**
 * Depo Injekcije PSA — Google Sheets sinhronizacija v7
 * =====================================================
 * Glavne lastnosti:
 *  - ena centralna baza, vendar ločeno nalaganje/shranjevanje po ambulanti
 *  - LockService pri vsaki spremembi
 *  - revizija za vsako ambulanto; zastarela kopija ne more prepisati novejše
 *  - pacient je aktiven samo v eni ambulanti
 *  - dvostopenjska premestitev pacienta med ambulantama
 *  - termini in zaloga ostanejo vezani na ambulanto
 *  - PSA in pacientova zgodovina se ob premestitvi ohranita
 *  - zgodovina je razrezana na varne kose, ne v eno preveliko celico
 *
 * Posodobitev obstoječega deploymenta:
 *  1. Apps Script -> zamenjaj staro kodo s to datoteko.
 *  2. Save.
 *  3. Deploy -> Manage deployments -> Edit (svinčnik).
 *  4. Version -> New version -> Deploy.
 *
 * Obstoječi /exec URL ostane isti.
 */

var PROTOCOL_VERSION = 7;
var SHEET_DATA = 'DATA';
var SHEET_META = 'META';
var SHEET_HIST = 'ZGODOVINA';
var SHEET_VIEW = 'PACIENTI';
var SHEET_TRANSFERS = 'PREMESTITVE';
var SHEET_AUDIT = 'AUDIT_LOG';
var SHEET_DIAG = 'DIAG_TEST';
var CHUNK_SIZE = 45000;
var KEEP_VERSIONS = 10;
var LOCK_TIMEOUT_MS = 30000;

function doGet(e) {
  var action = param_(e, 'action') || 'ping';
  try {
    if (action === 'ping') return json_({ ok: true, protocol: PROTOCOL_VERSION, msg: 'pong', time: nowIso_() });
    if (action === 'diag') return diagTest_();
    if (action === 'listClinics') return listClinics_();
    if (action === 'loadClinic') return loadClinic_(param_(e, 'clinicId'));
    if (action === 'searchPatient') return searchPatient_(param_(e, 'maticni'), param_(e, 'clinicId'));
    if (action === 'history') return listHistory_();
    if (action === 'load') return legacyLoad_();
    if (action === 'restore') return json_({ ok: false, error: 'Obnova je dovoljena samo prek POST.' });
    return json_({ ok: false, error: 'GET ne podpira akcije: ' + action });
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = body.action || param_(e, 'action') || '';

    if (action === 'ping') return json_({ ok: true, protocol: PROTOCOL_VERSION, msg: 'pong', time: nowIso_() });
    if (action === 'diag') return diagTest_();
    if (action === 'listClinics') return listClinics_();
    if (action === 'loadClinic') return loadClinic_(body.clinicId);
    if (action === 'saveClinic') return saveClinic_(body);
    if (action === 'requestTransfer') return requestTransfer_(body);
    if (action === 'acceptTransfer') return acceptTransfer_(body);
    if (action === 'rejectTransfer') return rejectTransfer_(body);
    if (action === 'cancelTransfer') return cancelTransfer_(body);
    if (action === 'searchPatient') return searchPatient_(body.maticni, body.clinicId);
    if (action === 'history') return listHistory_();
    if (action === 'restore') return restoreVersion_(body.id, body.deviceName || 'neznana naprava');
    if (action === 'save') return legacySaveRejected_();

    return json_({ ok: false, error: 'Neznana akcija: ' + action });
  } catch (err) {
    return json_({ ok: false, error: errorText_(err) });
  }
}

// -----------------------------------------------------------------------------
// Osnovni helperji
// -----------------------------------------------------------------------------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getSheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) sh = ss_().insertSheet(name);
  return sh;
}

function param_(e, name) {
  return e && e.parameter && e.parameter[name] !== undefined ? String(e.parameter[name]) : '';
}

function parseBody_(e) {
  var text = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (err) { throw new Error('Telo zahtevka ni veljaven JSON.'); }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function nowIso_() { return new Date().toISOString(); }
function errorText_(err) { return err && err.message ? String(err.message) : String(err); }
function clone_(value) { return JSON.parse(JSON.stringify(value)); }

function normalizeClinicId_(value) {
  var id = String(value || '').trim();
  if (!/^amb_[a-z0-9][a-z0-9-]{1,50}$/i.test(id)) throw new Error('Neveljaven clinicId.');
  return id;
}

function normalizePatientId_(value) {
  var id = Number(value);
  if (!isFinite(id) || id < 1 || Math.floor(id) !== id) throw new Error('Neveljaven ID pacienta.');
  return id;
}

function withLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Baza je trenutno zasedena. Poskusi ponovno čez nekaj sekund.');
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function audit_(action, clinicId, entityId, deviceName, detail) {
  try {
    var sh = getSheet_(SHEET_AUDIT);
    if (sh.getLastRow() === 0) sh.appendRow(['Čas', 'Akcija', 'Ambulanta', 'Entiteta', 'Naprava', 'Podrobnosti']);
    sh.appendRow([nowIso_(), action || '', clinicId || '', entityId || '', deviceName || '', detail || '']);
  } catch (err) {
    // Audit ne sme preprečiti glavnega zapisa.
  }
}

// -----------------------------------------------------------------------------
// Branje/pisanje centralnega JSON-a
// -----------------------------------------------------------------------------
function readFullData_() {
  var meta = getSheet_(SHEET_META);
  var count = parseInt(meta.getRange('A1').getValue(), 10);
  if (!count || count < 1 || isNaN(count)) return null;
  var rows = getSheet_(SHEET_DATA).getRange(1, 1, count, 1).getValues();
  var parts = [];
  for (var i = 0; i < rows.length; i++) parts.push(String(rows[i][0] || ''));
  return parts.join('');
}

function readState_() {
  var full = readFullData_();
  var state;
  if (!full) {
    state = emptyState_();
  } else {
    try { state = JSON.parse(full); }
    catch (err) { throw new Error('Centralna baza vsebuje poškodovan JSON. Obnovi prejšnjo verzijo.'); }
  }
  return ensureState_(state);
}

function emptyState_() {
  return {
    schemaVersion: 7,
    pacienti: [],
    termini: [],
    ambulante: [],
    zdravila: [],
    zaloge: {},
    zalogeLog: [],
    nextId: 1,
    settings: {},
    transferRequests: [],
    syncMeta: {
      protocol: PROTOCOL_VERSION,
      globalRevision: 0,
      clinicRevisions: {},
      updatedAt: '',
      updatedBy: ''
    }
  };
}

function ensureState_(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = emptyState_();
  if (!Array.isArray(state.pacienti)) state.pacienti = [];
  if (!Array.isArray(state.termini)) state.termini = [];
  if (!Array.isArray(state.ambulante)) state.ambulante = [];
  if (!Array.isArray(state.zdravila)) state.zdravila = [];
  if (!Array.isArray(state.zalogeLog)) state.zalogeLog = [];
  if (!state.zaloge || typeof state.zaloge !== 'object' || Array.isArray(state.zaloge)) state.zaloge = {};
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) state.settings = {};
  if (!Array.isArray(state.transferRequests)) state.transferRequests = [];
  if (!state.syncMeta || typeof state.syncMeta !== 'object') state.syncMeta = {};
  if (!state.syncMeta.clinicRevisions || typeof state.syncMeta.clinicRevisions !== 'object') state.syncMeta.clinicRevisions = {};
  state.syncMeta.protocol = PROTOCOL_VERSION;
  state.syncMeta.globalRevision = Number(state.syncMeta.globalRevision) || 0;
  state.syncMeta.updatedAt = String(state.syncMeta.updatedAt || '');
  state.syncMeta.updatedBy = String(state.syncMeta.updatedBy || '');
  state.schemaVersion = Math.max(Number(state.schemaVersion) || 1, 7);

  // Migracija stare enojne baze v eno ambulanto.
  if (state.ambulante.length === 0 && (state.pacienti.length || state.termini.length || Object.keys(state.zaloge).length)) {
    var name = String(state.settings.ordinacija || 'Ambulanta').trim() || 'Ambulanta';
    var id = makeClinicId_(name, state.ambulante);
    state.ambulante.push({
      id: id,
      name: name,
      active: true,
      settings: clinicSettingsFromLegacy_(state.settings, name),
      zaloge: clone_(state.zaloge),
      zalogeLog: clone_(state.zalogeLog),
      createdAt: nowIso_(),
      updatedAt: nowIso_()
    });
    for (var p = 0; p < state.pacienti.length; p++) {
      if (!state.pacienti[p].primarnaAmbulantaId) state.pacienti[p].primarnaAmbulantaId = id;
    }
    for (var t = 0; t < state.termini.length; t++) {
      if (!state.termini[t].ambulantaId) state.termini[t].ambulantaId = id;
    }
    state.syncMeta.clinicRevisions[id] = Number(state.syncMeta.clinicRevisions[id]) || 0;
  }

  // Normalizacija ambulant in ID-jev.
  var clinicIds = {};
  for (var a = 0; a < state.ambulante.length; a++) {
    var clinic = state.ambulante[a] || {};
    if (!clinic.id || clinicIds[clinic.id]) clinic.id = makeClinicId_(clinic.name || clinic.ime || 'Ambulanta', state.ambulante, clinicIds);
    clinic.id = String(clinic.id);
    clinicIds[clinic.id] = true;
    clinic.name = String(clinic.name || clinic.ime || (clinic.settings && clinic.settings.ordinacija) || 'Ambulanta');
    clinic.active = clinic.active !== false;
    if (!clinic.settings || typeof clinic.settings !== 'object') clinic.settings = clinicSettingsFromLegacy_(state.settings, clinic.name);
    clinic.settings.ordinacija = clinic.name;
    if (!clinic.zaloge || typeof clinic.zaloge !== 'object' || Array.isArray(clinic.zaloge)) clinic.zaloge = {};
    if (!Array.isArray(clinic.zalogeLog)) clinic.zalogeLog = [];
    state.syncMeta.clinicRevisions[clinic.id] = Number(state.syncMeta.clinicRevisions[clinic.id]) || 0;
  }

  var maxId = 0;
  for (var i = 0; i < state.pacienti.length; i++) {
    var patient = state.pacienti[i];
    patient.id = Number(patient.id) || 0;
    if (patient.id > maxId) maxId = patient.id;
    if (!patient.primarnaAmbulantaId && state.ambulante.length) patient.primarnaAmbulantaId = state.ambulante[0].id;
    if (!Array.isArray(patient.psa)) patient.psa = [];
    if (!Array.isArray(patient.premestitve)) patient.premestitve = [];
  }
  state.nextId = Math.max(Number(state.nextId) || 1, maxId + 1);
  return state;
}

function makeClinicId_(name, clinics, used) {
  var base = String(name || 'ambulanta').toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 28) || 'ambulanta';
  var existing = used || {};
  if (clinics) for (var i = 0; i < clinics.length; i++) if (clinics[i] && clinics[i].id) existing[clinics[i].id] = true;
  var id = 'amb_' + base;
  var n = 2;
  while (existing[id]) id = 'amb_' + base + '-' + n++;
  return id;
}

function clinicSettingsFromLegacy_(settings, name) {
  settings = settings || {};
  return {
    ordinacija: name,
    maxPacientov: Number(settings.maxPacientov) || 5,
    start: String(settings.start || '09:00'),
    end: String(settings.end || '11:00'),
    slotDuration: Number(settings.slotDuration) || 30,
    breakStart: String(settings.breakStart || ''),
    breakEnd: String(settings.breakEnd || ''),
    workDays: Array.isArray(settings.workDays) && settings.workDays.length ? clone_(settings.workDays) : [1, 2, 3, 4, 5]
  };
}

function writeState_(state, options) {
  options = options || {};
  state = ensureState_(state);
  var current = readFullData_();
  if (current && options.snapshot !== false) snapshotToHistory_(current);

  var text = JSON.stringify(state);
  var chunks = [];
  for (var i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.substring(i, i + CHUNK_SIZE));
  if (chunks.length === 0) chunks.push('');

  var dataSheet = getSheet_(SHEET_DATA);
  var clearRows = Math.max(dataSheet.getLastRow(), chunks.length, 1);
  dataSheet.getRange(1, 1, clearRows, 2).clearContent();
  var values = [];
  for (var c = 0; c < chunks.length; c++) values.push([chunks[c]]);
  dataSheet.getRange(1, 1, values.length, 1).setValues(values);

  var meta = getSheet_(SHEET_META);
  meta.getRange('A1').setValue(chunks.length);
  meta.getRange('A2').setValue(state.syncMeta.updatedAt || nowIso_());
  meta.getRange('A3').setValue(state.syncMeta.globalRevision || 0);
  meta.getRange('A4').setValue(PROTOCOL_VERSION);

  try { refreshView_(state); } catch (err) {}
  try { refreshTransfersView_(state); } catch (err2) {}
}

// -----------------------------------------------------------------------------
// Snapshot za posamezno ambulanto
// -----------------------------------------------------------------------------
function sanitizedClinics_(state) {
  return state.ambulante.map(function (a) {
    return {
      id: a.id,
      name: a.name,
      active: a.active !== false,
      settings: clone_(a.settings || {}),
      zaloge: clone_(a.zaloge || {}),
      zalogeLog: clone_(a.zalogeLog || []),
      createdAt: a.createdAt || '',
      updatedAt: a.updatedAt || ''
    };
  });
}

function buildClinicSnapshot_(state, clinicId) {
  clinicId = normalizeClinicId_(clinicId);
  var clinic = findClinic_(state, clinicId);
  if (!clinic) throw new Error('Ambulanta ne obstaja: ' + clinicId);

  var patientIds = {};
  var patients = [];
  for (var i = 0; i < state.pacienti.length; i++) {
    var p = state.pacienti[i];
    if (String(p.primarnaAmbulantaId || '') === clinicId) {
      patients.push(clone_(p));
      patientIds[Number(p.id)] = true;
    }
  }

  // Trenutna ambulanta dobi svoje termine in celotno zgodovino svojih pacientov.
  var appointments = [];
  for (var t = 0; t < state.termini.length; t++) {
    var appt = state.termini[t];
    if (String(appt.ambulantaId || '') === clinicId || patientIds[Number(appt.pacientId)]) appointments.push(clone_(appt));
  }

  var transfers = [];
  for (var r = 0; r < state.transferRequests.length; r++) {
    var tr = state.transferRequests[r];
    if (tr.status !== 'pending') continue;
    if (tr.fromClinicId !== clinicId && tr.toClinicId !== clinicId) continue;
    var tp = findPatient_(state, Number(tr.patientId));
    transfers.push({
      id: tr.id,
      patientId: tr.patientId,
      patient: tp ? {
        id: tp.id,
        ime: tp.ime || '',
        priimek: tp.priimek || '',
        maticni: tp.maticni || '',
        zdravilo: tp.zdravilo || '',
        odmerek: tp.odmerek || '',
        status: tp.status || ''
      } : null,
      fromClinicId: tr.fromClinicId,
      toClinicId: tr.toClinicId,
      reason: tr.reason || '',
      requestedAt: tr.requestedAt || '',
      requestedBy: tr.requestedBy || '',
      status: tr.status
    });
  }

  var localSettings = clone_(state.settings || {});
  delete localSettings.sheetsUrl;
  delete localSettings.lastCloudSync;

  return {
    schemaVersion: Math.max(Number(state.schemaVersion) || 1, 7),
    pacienti: patients,
    termini: appointments,
    ambulante: sanitizedClinics_(state),
    zdravila: clone_(state.zdravila || []),
    zaloge: clone_(clinic.zaloge || {}),
    zalogeLog: clone_(clinic.zalogeLog || []),
    nextId: state.nextId,
    settings: localSettings,
    transferRequests: transfers,
    sync: {
      protocol: PROTOCOL_VERSION,
      clinicId: clinicId,
      clinicRevision: Number(state.syncMeta.clinicRevisions[clinicId]) || 0,
      globalRevision: Number(state.syncMeta.globalRevision) || 0,
      updatedAt: state.syncMeta.updatedAt || ''
    }
  };
}

function listClinics_() {
  var state = readState_();
  return json_({
    ok: true,
    protocol: PROTOCOL_VERSION,
    clinics: sanitizedClinics_(state),
    globalRevision: state.syncMeta.globalRevision || 0,
    updatedAt: state.syncMeta.updatedAt || null
  });
}

function loadClinic_(clinicId) {
  if (!clinicId) return json_({ ok: false, error: 'Manjka clinicId.' });
  var state = readState_();
  var snapshot = buildClinicSnapshot_(state, clinicId);
  return json_({
    ok: true,
    protocol: PROTOCOL_VERSION,
    data: JSON.stringify(snapshot),
    clinicRevision: snapshot.sync.clinicRevision,
    globalRevision: snapshot.sync.globalRevision,
    updatedAt: snapshot.sync.updatedAt
  });
}

// -----------------------------------------------------------------------------
// Shranjevanje ambulantnega dela
// -----------------------------------------------------------------------------
function saveClinic_(body) {
  return withLock_(function () {
    var clinicId = normalizeClinicId_(body.clinicId);
    var baseRevision = Number(body.baseRevision) || 0;
    var deviceName = String(body.deviceName || 'neznana naprava').substring(0, 100);
    var payload = body.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); }
      catch (err) { throw new Error('Payload ni veljaven JSON.'); }
    }
    validateClinicPayload_(payload, clinicId);

    var state = readState_();
    var currentRevision = Number(state.syncMeta.clinicRevisions[clinicId]) || 0;
    var existingClinic = findClinic_(state, clinicId);

    // Nova ambulanta se lahko registrira z revizijo 0.
    if (existingClinic && baseRevision !== currentRevision) {
      return json_({
        ok: false,
        conflict: true,
        error: 'Ambulanta je bila medtem spremenjena na drugi napravi.',
        clinicRevision: currentRevision,
        globalRevision: state.syncMeta.globalRevision || 0
      });
    }
    if (!existingClinic && baseRevision !== 0) {
      return json_({ ok: false, conflict: true, error: 'Ambulanta na strežniku še ne obstaja.', clinicRevision: 0 });
    }

    var idMap = mergeClinicPayload_(state, payload, clinicId);
    var now = nowIso_();
    state.syncMeta.clinicRevisions[clinicId] = currentRevision + 1;
    state.syncMeta.globalRevision = Number(state.syncMeta.globalRevision || 0) + 1;
    state.syncMeta.updatedAt = now;
    state.syncMeta.updatedBy = deviceName;
    state.schemaVersion = Math.max(Number(state.schemaVersion) || 1, 7);

    writeState_(state, { snapshot: true });
    audit_('saveClinic', clinicId, '', deviceName, 'rev ' + currentRevision + ' -> ' + (currentRevision + 1));

    var snapshot = buildClinicSnapshot_(state, clinicId);
    return json_({
      ok: true,
      protocol: PROTOCOL_VERSION,
      updatedAt: now,
      clinicRevision: snapshot.sync.clinicRevision,
      globalRevision: snapshot.sync.globalRevision,
      idMap: idMap,
      data: JSON.stringify(snapshot)
    });
  });
}

function validateClinicPayload_(payload, clinicId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Manjka podatkovni payload.');
  if (!Array.isArray(payload.pacienti)) throw new Error('Payload nima seznama pacientov.');
  if (!Array.isArray(payload.termini)) throw new Error('Payload nima seznama terminov.');
  if (!Array.isArray(payload.ambulante)) throw new Error('Payload nima seznama ambulant.');
  var clinic = null;
  for (var i = 0; i < payload.ambulante.length; i++) if (String(payload.ambulante[i].id) === clinicId) clinic = payload.ambulante[i];
  if (!clinic) throw new Error('Payload ne vsebuje izbrane ambulante.');
}

function mergeClinicPayload_(state, payload, clinicId) {
  var incomingClinic = null;
  for (var i = 0; i < payload.ambulante.length; i++) {
    if (String(payload.ambulante[i].id) === clinicId) incomingClinic = clone_(payload.ambulante[i]);
  }
  incomingClinic.id = clinicId;
  incomingClinic.name = String(incomingClinic.name || (incomingClinic.settings && incomingClinic.settings.ordinacija) || 'Ambulanta');
  incomingClinic.active = incomingClinic.active !== false;
  if (!incomingClinic.settings || typeof incomingClinic.settings !== 'object') incomingClinic.settings = clinicSettingsFromLegacy_({}, incomingClinic.name);
  incomingClinic.settings.ordinacija = incomingClinic.name;
  if (!incomingClinic.zaloge || typeof incomingClinic.zaloge !== 'object') incomingClinic.zaloge = {};
  if (!Array.isArray(incomingClinic.zalogeLog)) incomingClinic.zalogeLog = [];
  incomingClinic.updatedAt = nowIso_();

  var clinicIndex = indexOfClinic_(state, clinicId);
  if (clinicIndex < 0) {
    incomingClinic.createdAt = incomingClinic.createdAt || nowIso_();
    state.ambulante.push(incomingClinic);
  } else {
    var createdAt = state.ambulante[clinicIndex].createdAt || incomingClinic.createdAt || nowIso_();
    state.ambulante[clinicIndex] = incomingClinic;
    state.ambulante[clinicIndex].createdAt = createdAt;
  }

  // Globalni seznam zdravil je unija vseh ambulant.
  mergeMedicines_(state, payload.zdravila || []);

  // Najprej pripravimo ID remap za morebitne kolizije med ambulantama.
  var idMap = {};
  var incomingPatients = [];
  var maxId = maxPatientId_(state);
  for (var p = 0; p < payload.pacienti.length; p++) {
    var patient = clone_(payload.pacienti[p]);
    if (String(patient.primarnaAmbulantaId || clinicId) !== clinicId) continue;
    var oldId = normalizePatientId_(patient.id);
    var collision = findPatient_(state, oldId);
    if (collision && String(collision.primarnaAmbulantaId || '') !== clinicId) {
      maxId++;
      idMap[String(oldId)] = maxId;
      patient.id = maxId;
    }
    patient.primarnaAmbulantaId = clinicId;
    if (!Array.isArray(patient.psa)) patient.psa = [];
    if (!Array.isArray(patient.premestitve)) patient.premestitve = [];
    validateDuplicateMaticni_(state, patient, clinicId, idMap);
    incomingPatients.push(patient);
  }

  // Popravimo patientId v terminih, če je strežnik moral zamenjati ID.
  var incomingTerms = [];
  for (var t = 0; t < payload.termini.length; t++) {
    var term = clone_(payload.termini[t]);
    if (String(term.ambulantaId || clinicId) !== clinicId) continue;
    var mapped = idMap[String(term.pacientId)];
    if (mapped) term.pacientId = mapped;
    term.ambulantaId = clinicId;
    term.id = String(term.id || ('t_' + new Date().getTime() + '_' + t));
    incomingTerms.push(term);
  }

  // Zamenjamo samo pacientov in termine te ambulante. Druga ambulanta ostane nedotaknjena.
  var keptPatients = [];
  for (var sp = 0; sp < state.pacienti.length; sp++) {
    if (String(state.pacienti[sp].primarnaAmbulantaId || '') !== clinicId) keptPatients.push(state.pacienti[sp]);
  }
  state.pacienti = keptPatients.concat(incomingPatients);

  var keptTerms = [];
  for (var st = 0; st < state.termini.length; st++) {
    if (String(state.termini[st].ambulantaId || '') !== clinicId) keptTerms.push(state.termini[st]);
  }
  state.termini = keptTerms.concat(incomingTerms);
  state.nextId = Math.max(Number(state.nextId) || 1, maxPatientId_(state) + 1, Number(payload.nextId) || 1);

  return idMap;
}

function validateDuplicateMaticni_(state, incoming, clinicId, idMap) {
  var maticni = String(incoming.maticni || '').trim().toLowerCase();
  if (!maticni) return;
  for (var i = 0; i < state.pacienti.length; i++) {
    var existing = state.pacienti[i];
    var existingId = Number(existing.id);
    var mappedId = Number(idMap[String(incoming.id)] || incoming.id);
    if (existingId === mappedId) continue;
    if (String(existing.maticni || '').trim().toLowerCase() === maticni && String(existing.primarnaAmbulantaId || '') !== clinicId) {
      throw new Error('Pacient z matičnim indeksom ' + incoming.maticni + ' že obstaja v ambulanti ' + clinicName_(state, existing.primarnaAmbulantaId) + '. Uporabi premestitev, ne novega vnosa.');
    }
  }
}

function mergeMedicines_(state, incoming) {
  var keys = {};
  for (var i = 0; i < state.zdravila.length; i++) keys[medicineKey_(state.zdravila[i])] = true;
  for (var j = 0; j < incoming.length; j++) {
    var med = clone_(incoming[j]);
    var key = medicineKey_(med);
    if (!key || keys[key]) continue;
    keys[key] = true;
    state.zdravila.push(med);
  }
}

function medicineKey_(med) {
  if (!med) return '';
  return String(med.ime || '').trim().toLowerCase() + '||' + String(med.odmerek || '').trim();
}

// -----------------------------------------------------------------------------
// Premestitve
// -----------------------------------------------------------------------------
function requestTransfer_(body) {
  return withLock_(function () {
    var fromId = normalizeClinicId_(body.fromClinicId);
    var toId = normalizeClinicId_(body.toClinicId);
    var patientId = normalizePatientId_(body.patientId);
    var baseRevision = Number(body.baseRevision) || 0;
    var deviceName = String(body.deviceName || 'neznana naprava').substring(0, 100);
    if (fromId === toId) return json_({ ok: false, error: 'Izvorna in ciljna ambulanta sta enaki.' });

    var state = readState_();
    if (!findClinic_(state, fromId) || !findClinic_(state, toId)) return json_({ ok: false, error: 'Ambulanta ne obstaja.' });
    var currentRevision = Number(state.syncMeta.clinicRevisions[fromId]) || 0;
    if (baseRevision !== currentRevision) return json_({ ok: false, conflict: true, error: 'Podatki izvorne ambulante niso več sveži.', clinicRevision: currentRevision });

    var patient = findPatient_(state, patientId);
    if (!patient || String(patient.primarnaAmbulantaId || '') !== fromId) return json_({ ok: false, error: 'Pacient ni aktiven v izvorni ambulanti.' });
    for (var i = 0; i < state.transferRequests.length; i++) {
      if (Number(state.transferRequests[i].patientId) === patientId && state.transferRequests[i].status === 'pending') {
        return json_({ ok: false, error: 'Za tega pacienta že obstaja čakajoča premestitev.' });
      }
    }

    var request = {
      id: 'tr_' + new Date().getTime() + '_' + Math.random().toString(36).substring(2, 8),
      patientId: patientId,
      fromClinicId: fromId,
      toClinicId: toId,
      reason: String(body.reason || '').substring(0, 500),
      status: 'pending',
      requestedAt: nowIso_(),
      requestedBy: deviceName
    };
    state.transferRequests.push(request);
    patient.transferStatus = 'pending';
    patient.transferRequestId = request.id;

    bumpClinics_(state, [fromId, toId], deviceName);
    writeState_(state, { snapshot: true });
    audit_('requestTransfer', fromId, String(patientId), deviceName, fromId + ' -> ' + toId);
    return json_({ ok: true, request: request, clinicRevision: state.syncMeta.clinicRevisions[fromId], updatedAt: state.syncMeta.updatedAt });
  });
}

function acceptTransfer_(body) {
  return withLock_(function () {
    var requestId = String(body.requestId || '');
    var clinicId = normalizeClinicId_(body.clinicId);
    var baseRevision = Number(body.baseRevision) || 0;
    var deviceName = String(body.deviceName || 'neznana naprava').substring(0, 100);
    var state = readState_();
    var currentRevision = Number(state.syncMeta.clinicRevisions[clinicId]) || 0;
    if (baseRevision !== currentRevision) return json_({ ok: false, conflict: true, error: 'Podatki ciljne ambulante niso več sveži.', clinicRevision: currentRevision });

    var request = findTransfer_(state, requestId);
    if (!request || request.status !== 'pending') return json_({ ok: false, error: 'Čakajoča premestitev ni najdena.' });
    if (request.toClinicId !== clinicId) return json_({ ok: false, error: 'To premestitev lahko sprejme samo ciljna ambulanta.' });
    var patient = findPatient_(state, Number(request.patientId));
    if (!patient) return json_({ ok: false, error: 'Pacient ne obstaja.' });

    var now = nowIso_();
    var fromId = request.fromClinicId;
    patient.primarnaAmbulantaId = clinicId;
    patient.transferStatus = '';
    patient.transferRequestId = '';
    if (!Array.isArray(patient.premestitve)) patient.premestitve = [];
    patient.premestitve.push({ od: fromId, do: clinicId, datum: now.substring(0, 10), cas: now, razlog: request.reason || '', sprejel: deviceName });

    // Prihodnje čakajoče termine v stari ambulanti prekličemo; opravljena zgodovina ostane.
    for (var i = 0; i < state.termini.length; i++) {
      var term = state.termini[i];
      if (Number(term.pacientId) === Number(patient.id) && term.ambulantaId === fromId && term.status === 'caka') {
        term.status = 'preklican';
        term.opomba = (term.opomba ? term.opomba + ' · ' : '') + 'preklican ob premestitvi v ' + clinicName_(state, clinicId);
      }
    }

    request.status = 'accepted';
    request.resolvedAt = now;
    request.resolvedBy = deviceName;
    bumpClinics_(state, [fromId, clinicId], deviceName);
    state.nextId = Math.max(Number(state.nextId) || 1, maxPatientId_(state) + 1);
    writeState_(state, { snapshot: true });
    audit_('acceptTransfer', clinicId, String(patient.id), deviceName, fromId + ' -> ' + clinicId);

    var snapshot = buildClinicSnapshot_(state, clinicId);
    return json_({ ok: true, data: JSON.stringify(snapshot), clinicRevision: snapshot.sync.clinicRevision, updatedAt: snapshot.sync.updatedAt });
  });
}

function rejectTransfer_(body) {
  return resolveTransferWithoutMove_(body, 'rejected');
}

function cancelTransfer_(body) {
  return resolveTransferWithoutMove_(body, 'cancelled');
}

function resolveTransferWithoutMove_(body, status) {
  return withLock_(function () {
    var requestId = String(body.requestId || '');
    var clinicId = normalizeClinicId_(body.clinicId);
    var baseRevision = Number(body.baseRevision) || 0;
    var deviceName = String(body.deviceName || 'neznana naprava').substring(0, 100);
    var state = readState_();
    var currentRevision = Number(state.syncMeta.clinicRevisions[clinicId]) || 0;
    if (baseRevision !== currentRevision) return json_({ ok: false, conflict: true, error: 'Podatki ambulante niso več sveži.', clinicRevision: currentRevision });
    var request = findTransfer_(state, requestId);
    if (!request || request.status !== 'pending') return json_({ ok: false, error: 'Čakajoča premestitev ni najdena.' });
    if (status === 'rejected' && request.toClinicId !== clinicId) return json_({ ok: false, error: 'Premestitev lahko zavrne samo ciljna ambulanta.' });
    if (status === 'cancelled' && request.fromClinicId !== clinicId) return json_({ ok: false, error: 'Premestitev lahko prekliče samo izvorna ambulanta.' });

    request.status = status;
    request.resolvedAt = nowIso_();
    request.resolvedBy = deviceName;
    request.resolveReason = String(body.reason || '').substring(0, 500);
    var patient = findPatient_(state, Number(request.patientId));
    if (patient) {
      patient.transferStatus = '';
      patient.transferRequestId = '';
    }
    bumpClinics_(state, [request.fromClinicId, request.toClinicId], deviceName);
    writeState_(state, { snapshot: true });
    audit_(status === 'rejected' ? 'rejectTransfer' : 'cancelTransfer', clinicId, String(request.patientId), deviceName, request.id);
    return json_({ ok: true, clinicRevision: state.syncMeta.clinicRevisions[clinicId], updatedAt: state.syncMeta.updatedAt });
  });
}

function bumpClinics_(state, clinicIds, deviceName) {
  var seen = {};
  for (var i = 0; i < clinicIds.length; i++) {
    var id = clinicIds[i];
    if (!id || seen[id]) continue;
    seen[id] = true;
    state.syncMeta.clinicRevisions[id] = Number(state.syncMeta.clinicRevisions[id] || 0) + 1;
  }
  state.syncMeta.globalRevision = Number(state.syncMeta.globalRevision || 0) + 1;
  state.syncMeta.updatedAt = nowIso_();
  state.syncMeta.updatedBy = deviceName;
}

function searchPatient_(maticni, requestingClinicId) {
  var key = String(maticni || '').trim().toLowerCase();
  if (key.length < 3) return json_({ ok: false, error: 'Vnesi celoten matični indeks.' });
  var state = readState_();
  for (var i = 0; i < state.pacienti.length; i++) {
    var p = state.pacienti[i];
    if (String(p.maticni || '').trim().toLowerCase() === key) {
      return json_({
        ok: true,
        found: true,
        patient: {
          id: p.id,
          ime: p.ime || '',
          priimek: p.priimek || '',
          maticni: p.maticni || '',
          clinicId: p.primarnaAmbulantaId || '',
          clinicName: clinicName_(state, p.primarnaAmbulantaId),
          sameClinic: String(p.primarnaAmbulantaId || '') === String(requestingClinicId || ''),
          transferPending: p.transferStatus === 'pending'
        }
      });
    }
  }
  return json_({ ok: true, found: false });
}

// -----------------------------------------------------------------------------
// Zgodovina
// -----------------------------------------------------------------------------
function ensureHistoryFormat_(hist) {
  var first = String(hist.getRange('A1').getValue() || '');
  if (first !== 'VersionId') {
    hist.clear();
    hist.appendRow(['VersionId', 'Timestamp', 'Pacientov', 'ChunkIndex', 'ChunkCount', 'Data']);
  }
}

function snapshotToHistory_(fullText) {
  if (!fullText) return;
  var state;
  try { state = JSON.parse(fullText); } catch (err) { return; }
  var versionId = 'v_' + new Date().getTime() + '_' + Math.random().toString(36).substring(2, 7);
  var ts = state.syncMeta && state.syncMeta.updatedAt ? state.syncMeta.updatedAt : nowIso_();
  var count = Array.isArray(state.pacienti) ? state.pacienti.length : 0;
  var chunks = [];
  for (var i = 0; i < fullText.length; i += CHUNK_SIZE) chunks.push(fullText.substring(i, i + CHUNK_SIZE));
  if (!chunks.length) chunks.push('');

  var hist = getSheet_(SHEET_HIST);
  ensureHistoryFormat_(hist);
  var rows = [];
  for (var c = 0; c < chunks.length; c++) rows.push([versionId, String(ts), count, c, chunks.length, chunks[c]]);
  hist.getRange(hist.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  trimHistory_(hist);
}

function trimHistory_(hist) {
  var last = hist.getLastRow();
  if (last <= 1) return;
  var ids = hist.getRange(2, 1, last - 1, 1).getValues();
  var order = [];
  var seen = {};
  for (var i = ids.length - 1; i >= 0; i--) {
    var id = String(ids[i][0] || '');
    if (id && !seen[id]) { seen[id] = true; order.push(id); }
  }
  var keep = {};
  for (var k = 0; k < Math.min(KEEP_VERSIONS, order.length); k++) keep[order[k]] = true;
  var all = hist.getRange(2, 1, last - 1, 6).getValues();
  var retained = [];
  for (var r = 0; r < all.length; r++) if (keep[String(all[r][0] || '')]) retained.push(all[r]);
  hist.getRange(2, 1, last - 1, 6).clearContent();
  if (retained.length) hist.getRange(2, 1, retained.length, 6).setValues(retained);
  if (hist.getLastRow() > retained.length + 1) hist.deleteRows(retained.length + 2, hist.getLastRow() - retained.length - 1);
}

function listHistory_() {
  var hist = getSheet_(SHEET_HIST);
  ensureHistoryFormat_(hist);
  var last = hist.getLastRow();
  if (last <= 1) return json_({ ok: true, versions: [] });
  var rows = hist.getRange(2, 1, last - 1, 5).getValues();
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0] || '');
    if (!id) continue;
    if (!map[id]) map[id] = { id: id, updatedAt: String(rows[i][1] || ''), pacientov: Number(rows[i][2]) || 0, chunks: Number(rows[i][4]) || 0 };
  }
  var versions = [];
  for (var key in map) versions.push(map[key]);
  versions.sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
  return json_({ ok: true, versions: versions.slice(0, KEEP_VERSIONS) });
}

function restoreVersion_(id, deviceName) {
  return withLock_(function () {
    if (!id) return json_({ ok: false, error: 'Manjka id verzije.' });
    var hist = getSheet_(SHEET_HIST);
    ensureHistoryFormat_(hist);
    var last = hist.getLastRow();
    if (last <= 1) return json_({ ok: false, error: 'Ni zgodovine.' });
    var rows = hist.getRange(2, 1, last - 1, 6).getValues();
    var chunks = [];
    var chunkCount = 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(id)) continue;
      chunks[Number(rows[i][3]) || 0] = String(rows[i][5] || '');
      chunkCount = Number(rows[i][4]) || chunkCount;
    }
    if (!chunkCount || chunks.length < chunkCount) return json_({ ok: false, error: 'Verzija ni popolna ali ne obstaja.' });
    var text = chunks.slice(0, chunkCount).join('');
    var restored;
    try { restored = ensureState_(JSON.parse(text)); }
    catch (err) { return json_({ ok: false, error: 'Verzija vsebuje neveljaven JSON.' }); }

    var current = readFullData_();
    if (current) snapshotToHistory_(current);
    restored.syncMeta.globalRevision = Number(restored.syncMeta.globalRevision || 0) + 1;
    restored.syncMeta.updatedAt = nowIso_();
    restored.syncMeta.updatedBy = deviceName;
    for (var c = 0; c < restored.ambulante.length; c++) {
      var cid = restored.ambulante[c].id;
      restored.syncMeta.clinicRevisions[cid] = Number(restored.syncMeta.clinicRevisions[cid] || 0) + 1;
    }
    writeState_(restored, { snapshot: false });
    audit_('restore', '', id, deviceName, 'Obnovljena centralna verzija');
    return json_({ ok: true, restored: id, updatedAt: restored.syncMeta.updatedAt, globalRevision: restored.syncMeta.globalRevision });
  });
}

// -----------------------------------------------------------------------------
// Diagnostika in legacy zaščita
// -----------------------------------------------------------------------------
function diagTest_() {
  var sh = getSheet_(SHEET_DIAG);
  var stamp = nowIso_();
  sh.getRange('A1').setValue('DIAG_OK ' + stamp);
  var ok = String(sh.getRange('A1').getValue()).indexOf('DIAG_OK') === 0;
  var state = readState_();
  return json_({
    ok: ok,
    protocol: PROTOCOL_VERSION,
    msg: ok ? 'Pisanje in branje delujeta' : 'Težava',
    pacientov: state.pacienti.length,
    ambulant: state.ambulante.length,
    globalRevision: state.syncMeta.globalRevision || 0,
    updatedAt: state.syncMeta.updatedAt || null
  });
}

function legacyLoad_() {
  var state = readState_();
  return json_({
    ok: false,
    upgradeRequired: true,
    protocol: PROTOCOL_VERSION,
    error: 'Ta strežnik zahteva večambulantno aplikacijo v7. Posodobi EXE.',
    updatedAt: state.syncMeta.updatedAt || null
  });
}

function legacySaveRejected_() {
  return json_({
    ok: false,
    upgradeRequired: true,
    protocol: PROTOCOL_VERSION,
    error: 'Stari način shranjevanja celotne baze je izklopljen, ker lahko izgubi podatke druge ambulante. Posodobi EXE.'
  });
}

// -----------------------------------------------------------------------------
// Pogledni listi
// -----------------------------------------------------------------------------
function refreshView_(state) {
  var sh = getSheet_(SHEET_VIEW);
  sh.clear();
  var head = ['Ambulanta', 'Priimek', 'Ime', 'Mat. indeks', 'Telefon', 'Zdravilo', 'Odmerek', 'Interval', 'Zadnja injekcija', 'Status', 'Zadnji PSA', 'Datum PSA'];
  var rows = [head];
  for (var i = 0; i < state.pacienti.length; i++) {
    var p = state.pacienti[i];
    if (p.izbrisan) continue;
    var psa = p.psa && p.psa.length ? p.psa[p.psa.length - 1] : null;
    rows.push([
      clinicName_(state, p.primarnaAmbulantaId), p.priimek || '', p.ime || '', p.maticni || '', p.telefon || '',
      p.zdravilo || '', p.odmerek || '', p.interval || '', p.zadnjaInjekcija || '', p.status || '',
      psa ? psa.vrednost : '', psa ? psa.datum : ''
    ]);
  }
  sh.getRange(1, 1, rows.length, head.length).setValues(rows);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function refreshTransfersView_(state) {
  var sh = getSheet_(SHEET_TRANSFERS);
  sh.clear();
  var head = ['ID', 'Pacient', 'Od', 'Do', 'Status', 'Zahtevano', 'Razlog', 'Rešeno'];
  var rows = [head];
  for (var i = 0; i < state.transferRequests.length; i++) {
    var tr = state.transferRequests[i];
    var p = findPatient_(state, Number(tr.patientId));
    rows.push([
      tr.id || '', p ? (String(p.priimek || '') + ' ' + String(p.ime || '')) : tr.patientId,
      clinicName_(state, tr.fromClinicId), clinicName_(state, tr.toClinicId), tr.status || '',
      tr.requestedAt || '', tr.reason || '', tr.resolvedAt || ''
    ]);
  }
  sh.getRange(1, 1, rows.length, head.length).setValues(rows);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

// -----------------------------------------------------------------------------
// Iskanje
// -----------------------------------------------------------------------------
function findClinic_(state, id) {
  for (var i = 0; i < state.ambulante.length; i++) if (String(state.ambulante[i].id) === String(id)) return state.ambulante[i];
  return null;
}
function indexOfClinic_(state, id) {
  for (var i = 0; i < state.ambulante.length; i++) if (String(state.ambulante[i].id) === String(id)) return i;
  return -1;
}
function findPatient_(state, id) {
  for (var i = 0; i < state.pacienti.length; i++) if (Number(state.pacienti[i].id) === Number(id)) return state.pacienti[i];
  return null;
}
function findTransfer_(state, id) {
  for (var i = 0; i < state.transferRequests.length; i++) if (String(state.transferRequests[i].id) === String(id)) return state.transferRequests[i];
  return null;
}
function clinicName_(state, id) {
  var clinic = findClinic_(state, id);
  return clinic ? clinic.name : String(id || '');
}
function maxPatientId_(state) {
  var max = 0;
  for (var i = 0; i < state.pacienti.length; i++) max = Math.max(max, Number(state.pacienti[i].id) || 0);
  return max;
}
