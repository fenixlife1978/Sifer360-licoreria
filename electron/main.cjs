const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { createDurableOutbox } = require('./lan-outbox.cjs');
const { ensureServerCertificate, createPinnedAgent, retrievePeerCertificate, verifyFingerprint } = require('./lan-tls.cjs');
const { applyIncomingEvents } = require('./lan-event-store.cjs');
const { mergeStateRecords } = require('./lan-state-merge.cjs');
const { openOrRecoverDatabase } = require('./sqlite-recovery.cjs');
const { isLanAddress, assertLanHost } = require('./lan-address.cjs');
const { allocateCashboxSequence: allocateCashboxSequenceDurable } = require('./cashbox-sequence.cjs');
const { migrateCashboxSequenceCategories } = require('./cashbox-sequence-migration.cjs');
const initSqlJs = require('sql.js');

let db;
let SqlDatabase;
let dbConfigPath;
let databaseMode = 'sqlite';
let saveTimer;
let networkServer = null;
let discoveryServer = null;
const DISCOVERY_PORT = 38761;
function stopDiscoveryServer() { if (discoveryServer) { try { discoveryServer.close(); } catch {} discoveryServer = null; } }
function startDiscoveryServer() {
  stopDiscoveryServer();
  discoveryServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoveryServer.on('message', (message, remote) => {
    try {
      const packet = JSON.parse(message.toString('utf8'));
      if (packet.type !== 'SIFER360_DISCOVER_V1' || !networkServer || networkConfig.role !== 'server') return;
      const response = Buffer.from(JSON.stringify({ type: 'SIFER360_SERVER_V1', deviceId: networkConfig.deviceId, port: networkConfig.port, name: os.hostname(), addresses: localAddresses(), tlsFingerprint: networkConfig.tlsFingerprint }));
      discoveryServer.send(response, remote.port, remote.address, () => {});
    } catch {}
  });
  discoveryServer.on('error', () => stopDiscoveryServer());
  discoveryServer.bind(DISCOVERY_PORT, '0.0.0.0', () => { try { discoveryServer.setBroadcast(true); } catch {} });
}
async function discoverLanServers(timeoutMs = 2500) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();
    let done = false;
    const finish = () => { if (done) return; done = true; try { socket.close(); } catch {} resolve([...found.values()]); };
    socket.on('message', (message, remote) => {
      try {
        const data = JSON.parse(message.toString('utf8'));
        if (data.type !== 'SIFER360_SERVER_V1' || !Number(data.port)) return;
        const ips = Array.isArray(data.addresses) ? data.addresses : [];
        const host = ips.includes(remote.address) ? remote.address : (ips[0] || remote.address);
        found.set(data.deviceId || host, { host, port: Number(data.port), name: data.name || 'SIFER360', deviceId: data.deviceId, addresses: ips, tlsFingerprint: data.tlsFingerprint || '' });
      } catch {}
    });
    socket.on('error', finish);
    socket.bind(0, '0.0.0.0', () => {
      try { socket.setBroadcast(true); socket.send(Buffer.from(JSON.stringify({ type: 'SIFER360_DISCOVER_V1' })), DISCOVERY_PORT, '255.255.255.255'); } catch {}
      setTimeout(finish, Math.max(500, Math.min(8000, Number(timeoutMs) || 2500))).unref?.();
    });
  });
}
let networkConfig = { role: 'standalone', host: '', port: 38760, token: '', deviceId: '' };
let networkConfigPath;
let clientOutbox = null;
const MAX_SYNC_BODY = 8 * 1024 * 1024;
function readNetworkConfig() {
  networkConfigPath = path.join(app.getPath('userData'), 'network-mode.json');
  if (fs.existsSync(networkConfigPath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(networkConfigPath, 'utf8'));
      if (stored.tokenEncrypted) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado seguro del sistema operativo no está disponible para abrir la clave LAN.');
        stored.token = safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, 'base64'));
        delete stored.tokenEncrypted;
      }
      networkConfig = { ...networkConfig, ...stored };
    } catch (error) { throw new Error('La configuración LAN está dañada o no se pudo descifrar; no se reemplazará automáticamente. ' + (error.message || String(error))); }
  }
  if (!networkConfig.deviceId) networkConfig.deviceId = crypto.randomUUID();
  if (!networkConfig.token) networkConfig.token = crypto.randomBytes(24).toString('hex');
  clientOutbox = createDurableOutbox({ directory: app.getPath('userData'), deviceId: networkConfig.deviceId });
  saveNetworkConfig();
}
function saveNetworkConfig() {
  if (!networkConfigPath) throw new Error('No se ha inicializado la ruta de configuración LAN.');
  const temporary = networkConfigPath + '.tmp';
  let fd;
  try {
    const stored = { ...networkConfig };
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado seguro del sistema operativo no está disponible; no se guardará la clave LAN en texto claro.');
    if (stored.token) {
      stored.tokenEncrypted = safeStorage.encryptString(stored.token).toString('base64');
      delete stored.token;
    }
    fd = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(fd, JSON.stringify(stored, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, networkConfigPath);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw new Error('No se pudo guardar de forma durable la configuración LAN; no se confirma el cambio. ' + (error.message || String(error)));
  }
}
function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const item of (list || [])) if (item.family === 'IPv4' && !item.internal) out.push(item.address);
  return out;
}

function normalizeLanPort(value) {
  const port = Number(value || 38760);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('El puerto LAN debe ser un entero entre 1024 y 65535.');
  return port;
}
function sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'null' }); res.end(JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; let receivedBytes = 0; let rejected = false; req.on('data', chunk => { receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk)); if (receivedBytes > MAX_SYNC_BODY) { rejected = true; reject(new Error('La carga de sincronización excede 8 MB.')); req.destroy(); return; } raw += chunk; }); req.on('end', () => { if (rejected) return; try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON inválido.')); } }); req.on('error', error => { if (!rejected) reject(error); }); }); }
function statePayloadHash(payload) { return crypto.createHash('sha256').update(String(payload || '')).digest('hex'); }
function userDbPath() {
  return path.join(app.getPath('userData'), 'sifer360-licoreria.sqlite');
}
function databaseIntegrityStatus(database) {
  try {
    const result = database.exec('PRAGMA integrity_check');
    return result[0] && result[0].values[0] ? String(result[0].values[0][0]) : 'sin resultado';
  } catch (error) {
    return 'error: ' + (error && error.message ? error.message : String(error));
  }
}
function restoreDatabaseSnapshot(snapshot) {
  if (!SqlDatabase || !snapshot) throw new Error('No se pudo restaurar la instantánea de SQLite.');
  try { if (db) db.close(); } catch {}
  db = new SqlDatabase(snapshot);
  const integrity = databaseIntegrityStatus(db);
  if (integrity !== 'ok') throw new Error('La instantánea restaurada no superó integrity_check: ' + integrity);
}
function writeDurableFile(file, data) {
  let fd;
  try {
    fd = fs.openSync(file, 'w', 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function persistDb() {
  if (!db) return;
  const integrity = databaseIntegrityStatus(db);
  if (integrity !== 'ok') throw new Error('Se impidió guardar SQLite porque integrity_check no devolvió ok: ' + integrity);
  const target = userDbPath();
  const temporary = target + '.tmp';
  const backup = target + '.bak';
  const backupTemporary = backup + '.tmp';
  const bytes = db.export();
  writeDurableFile(temporary, Buffer.from(bytes));
  if (fs.existsSync(target)) {
    fs.copyFileSync(target, backupTemporary);
    const backupFd = fs.openSync(backupTemporary, 'r+');
    try { fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
    fs.renameSync(backupTemporary, backup);
  }
  fs.renameSync(temporary, target);
}
function persistMutation(mutate) {
  if (!db) throw new Error('SQLite no está inicializada.');
  const snapshot = db.export();
  try {
    const result = mutate();
    persistDb();
    return result;
  } catch (error) {
    try {
      restoreDatabaseSnapshot(snapshot);
    } catch (restoreError) {
      throw new Error('Falló la persistencia y también la restauración de SQLite. No continúe operando; conserve el archivo y el respaldo para recuperación. Error original: ' + (error.message || String(error)) + '. Error de restauración: ' + (restoreError.message || String(restoreError)));
    }
    throw error;
  }
}
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try { stmt.run(params); } finally { stmt.free(); }
}
function one(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : null;
  } finally { stmt.free(); }
}
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}
function initializeSchema() {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fiscal_documents (
      id TEXT PRIMARY KEY,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale','purchase')),
      transaction_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      data_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_fiscal_documents_transaction
      ON fiscal_documents(transaction_type, transaction_id);
    CREATE TABLE IF NOT EXISTS network_sync_events (
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_network_sync_events_created ON network_sync_events(created_at);
    CREATE TABLE IF NOT EXISTS local_operation_outbox (
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acked','conflict')),
      acked_at TEXT,
      UNIQUE(device_id, device_seq)
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON local_operation_outbox(status, device_seq);
    CREATE TABLE IF NOT EXISTS network_received_operations (
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(device_id, device_seq)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS cashbox_sequences (
      cashbox_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (cashbox_id, operation_type)
    );
    CREATE TABLE IF NOT EXISTS device_sequences (
      device_id TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_received_operations_device_seq ON network_received_operations(device_id, device_seq);
  `);
  persistDb();
}
async function initializeDatabase() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve('sql.js/dist/' + file) });
  SqlDatabase = SQL.Database;
  const file = userDbPath();
  const opened = openOrRecoverDatabase({ SQL, file });
  db = opened.database;
  if (opened.recovered) console.warn('SIFER360 recuperó la base SQLite desde el respaldo automático:', opened.source, opened.corruptFile || '');
  initializeSchema();
  const stateRowForSequenceMigration = one('SELECT payload FROM app_state WHERE id=1');
  const sequenceMigrationApplied = migrateCashboxSequenceCategories({ db, state: stateRowForSequenceMigration ? JSON.parse(stateRowForSequenceMigration.payload) : {}, persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
  if (opened.recovered && !sequenceMigrationApplied) persistDb();
  dbConfigPath = path.join(app.getPath('userData'), 'database-mode.json');
  databaseMode = 'sqlite';
  try {
    fs.writeFileSync(dbConfigPath, JSON.stringify({ mode: 'sqlite', updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch {}
}
async function setMode(mode) {
  databaseMode = 'sqlite';
  return { mode: 'sqlite', databasePath: userDbPath() };
}
async function startLanServer(requestedPort) {
  if (networkConfig.role === 'client' || networkConfig.serverPromotionBlocked) throw new Error('Este equipo ya fue cliente LAN y su SQLite local no se considera autoridad. No puede convertirse en servidor automáticamente; restaure o migre la base central mediante un procedimiento explícito antes de promoverlo.');
  if (!db) await initializeDatabase();
  const port = normalizeLanPort(requestedPort || networkConfig.port || 38760);
  if (networkServer) await new Promise(resolve => networkServer.close(resolve));
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado seguro del sistema operativo no está disponible; no se iniciará el servidor LAN.');
  const identity = await ensureServerCertificate({ directory: app.getPath('userData'), deviceId: networkConfig.deviceId, encryptPrivateKey: pem => safeStorage.encryptString(pem).toString('base64'), decryptPrivateKey: value => safeStorage.decryptString(Buffer.from(value, 'base64')) });
  networkConfig = { ...networkConfig, role: 'server', host: '', port, token: networkConfig.token || crypto.randomBytes(24).toString('hex'), tlsFingerprint: identity.fingerprint, serverCert: '' };
  saveNetworkConfig();
  networkServer = https.createServer({ key: identity.key, cert: identity.cert }, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!isLanAddress(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'Acceso permitido únicamente desde la red local.' });
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
    if (req.headers.authorization !== 'Bearer ' + networkConfig.token) return sendJson(res, 401, { error: 'No autorizado' });
    if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, deviceId: networkConfig.deviceId, role: 'server', protocol: 1 });
    if (url.pathname === '/api/documents' && req.method === 'GET') {
      const type = url.searchParams.get('transactionType');
      const transactionId = url.searchParams.get('transactionId');
      const documents = type && transactionId
        ? all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents WHERE transaction_type=? AND transaction_id=? ORDER BY created_at DESC', [type, transactionId])
        : all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents ORDER BY created_at DESC');
      return sendJson(res, 200, { ok: true, documents });
    }
    if (url.pathname === '/api/documents' && req.method === 'POST') {
      try {
        const doc = await readBody(req);
        if (!doc || !doc.id || !['sale','purchase'].includes(doc.transactionType) || !doc.transactionId || !doc.dataUrl) return sendJson(res, 400, { error: 'Documento incompleto.' });
        if (String(doc.dataUrl).length > 4300000) return sendJson(res, 413, { error: 'El archivo supera el límite local de 3 MB.' });
        const databaseBefore = db.export();
        run('INSERT OR REPLACE INTO fiscal_documents(id,transaction_type,transaction_id,file_name,mime_type,file_size,sha256,data_url,created_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [String(doc.id), doc.transactionType, String(doc.transactionId), String(doc.fileName || 'documento'), String(doc.mimeType || 'application/octet-stream'), Number(doc.fileSize || 0), String(doc.sha256 || ''), String(doc.dataUrl), String(doc.createdAt || new Date().toISOString()), String(doc.notes || '')]);
        try { persistDb(); } catch (error) { restoreDatabaseSnapshot(databaseBefore); throw error; }
        return sendJson(res, 200, { ok: true, durable: 'server-sqlite' });
      } catch (error) { return sendJson(res, 400, { error: error.message || 'No se pudo guardar el documento.' }); }
    }
    if (url.pathname.startsWith('/api/documents/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/documents/'.length));
      const document = one('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,data_url AS dataUrl,created_at AS createdAt,notes FROM fiscal_documents WHERE id=?', [id]);
      return sendJson(res, document ? 200 : 404, document ? { ok: true, document } : { error: 'Documento no encontrado.' });
    }
    if (url.pathname.startsWith('/api/documents/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/documents/'.length));
      const databaseBefore = db.export();
      run('DELETE FROM fiscal_documents WHERE id=?', [id]);
      try { persistDb(); } catch (error) { restoreDatabaseSnapshot(databaseBefore); throw error; }
      return sendJson(res, 200, { ok: true, durable: 'server-sqlite' });
    }
    if (url.pathname === '/api/sequences/next' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const result = allocateCashboxSequence(body.cashbox, body.operation, body.minimum);
        return sendJson(res, 200, result);
      } catch (error) { return sendJson(res, 400, { error: error.message || 'No se pudo reservar el consecutivo.' }); }
    }
    if (url.pathname === '/api/sync/events' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (!body || !Array.isArray(body.events) || body.events.length > 500) return sendJson(res, 400, { error: 'Lote inválido (máximo 500 operaciones).' });
        const result = applyIncomingEvents({
          db,
          events: body.events,
          persist: () => persistDb(),
          restore: snapshot => restoreDatabaseSnapshot(snapshot),
          statePayloadHash
        });
        return sendJson(res, 200, result);
      } catch (error) { return sendJson(res, 400, { error: error.message || 'Error recibiendo operaciones' }); }
    }
    if (url.pathname === '/api/sync/events' && req.method === 'GET') {
      const events = all('SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload FROM network_received_operations ORDER BY received_at LIMIT 1000').map(ev => ({ ...ev, payload: JSON.parse(ev.payload) }));
      return sendJson(res, 200, { ok: true, events });
    }
    if (url.pathname === '/api/sync/state' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (!body || typeof body.state !== 'object' || !body.deviceId || typeof body.expectedHash !== 'string') return sendJson(res, 400, { error: 'Paquete incompleto o sin versión de origen' });
        const incoming = body.state;
        const existing = one('SELECT payload FROM app_state WHERE id=1');
        const currentHash = statePayloadHash(existing ? existing.payload : '');
        if (body.expectedHash !== currentHash) return sendJson(res, 409, { error: 'La base central cambió desde la última lectura. Recargue los datos del servidor antes de volver a guardar.', conflict: true, stateHash: currentHash });
        const databaseBefore = db.export();
        const current = existing ? JSON.parse(existing.payload) : null;
        const merged = mergeStateRecords(current, incoming);
        run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
        const eventId = String(body.deviceId) + '-' + crypto.createHash('sha256').update(JSON.stringify(incoming)).digest('hex');
        run('INSERT OR IGNORE INTO network_sync_events(event_id,device_id,created_at,payload) VALUES(?,?,?,?)', [eventId, String(body.deviceId), new Date().toISOString(), JSON.stringify({ state: incoming })]);
        try { persistDb(); } catch (error) { restoreDatabaseSnapshot(databaseBefore); throw error; }
        const savedRow = one('SELECT payload FROM app_state WHERE id=1');
        return sendJson(res, 200, { ok: true, state: merged, stateHash: statePayloadHash(savedRow && savedRow.payload), serverDeviceId: networkConfig.deviceId, updatedAt: new Date().toISOString() });
      } catch (error) { return sendJson(res, 400, { error: error.message || 'Error sincronizando' }); }
    }
    if (url.pathname === '/api/sync/state' && req.method === 'GET') {
      const row = one('SELECT payload FROM app_state WHERE id=1');
      return sendJson(res, 200, { ok: true, state: row ? JSON.parse(row.payload) : null, stateHash: statePayloadHash(row && row.payload), serverDeviceId: networkConfig.deviceId, updatedAt: new Date().toISOString() });
    }
    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  });
  await new Promise((resolve, reject) => { networkServer.once('error', reject); networkServer.listen(port, '0.0.0.0', () => { networkServer.removeListener('error', reject); resolve(); }); });
  startDiscoveryServer();
  return { ...networkConfig, running: true, addresses: localAddresses() };
}
function allocateCashboxSequence(cashboxId, operationType, minimumValue = 1) {
  return allocateCashboxSequenceDurable({ db, cashboxId, operationType, minimumValue, persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
}
function requestPinnedJson(route, options = {}) {
  if (options.body && Buffer.byteLength(options.body, 'utf8') > MAX_SYNC_BODY) throw new Error('La operación supera el límite de tamaño permitido para sincronización LAN.');
  const agent = createPinnedAgent(networkConfig.serverCert, networkConfig.tlsFingerprint);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: networkConfig.host,
      port: networkConfig.port,
      path: route,
      method: options.method || 'GET',
      headers: { Authorization: 'Bearer ' + networkConfig.token, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      agent,
      timeout: options.timeoutMs || 10000
    }, response => {
      let raw = '';
      let receivedBytes = 0;
      response.setEncoding('utf8');
      response.on('data', chunk => { receivedBytes += Buffer.byteLength(chunk, 'utf8'); if (receivedBytes > MAX_SYNC_BODY) { request.destroy(new Error('La respuesta del servidor LAN excede el límite permitido.')); return; } raw += chunk; });
      response.on('end', () => {
        agent.destroy();
        let result = {};
        try { result = JSON.parse(raw || '{}'); } catch { return reject(new Error('El servidor LAN devolvió una respuesta JSON inválida.')); }
        if (response.statusCode < 200 || response.statusCode >= 300 || result.ok === false) return reject(new Error((response.statusCode === 409 ? 'Conflicto de concurrencia: ' : '') + (result.error || 'El servidor LAN no confirmó la operación (' + response.statusCode + ').')));
        resolve(result);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Tiempo agotado al comunicarse con el servidor LAN.')));
    request.on('error', error => { agent.destroy(); reject(error); });
    if (options.body) request.write(options.body);
    request.end();
  });
}
async function clientApi(route, options = {}) {
  if (networkConfig.role !== 'client' || !networkConfig.host || !networkConfig.token || !networkConfig.serverCert || !networkConfig.tlsFingerprint) throw new Error('Cliente sin conexión segura configurada al servidor LAN.');
  assertLanHost(networkConfig.host);
  return requestPinnedJson(route, options);
}
async function flushClientOutbox() {
  if (networkConfig.role !== 'client' || !networkConfig.host || !clientOutbox) return { pending: 0, accepted: [], conflicts: [] };
  const currentStatus = clientOutbox.status();
  if (currentStatus.conflicts > 0) throw new Error('Hay conflictos LAN sin resolver. Se bloqueó el snapshot completo hasta conciliar las operaciones afectadas.');
  const pending = clientOutbox.pending().slice(0, 500);
  const foreignServerEvents = pending.filter(event => event.serverDeviceId && event.serverDeviceId !== networkConfig.serverDeviceId);
  if (foreignServerEvents.length) {
    clientOutbox.conflict(foreignServerEvents.map(event => event.eventId), 'server-identity-changed');
    throw new Error('La cola LAN contiene operaciones del servidor anterior. No se enviarán a otra base de datos; concilie esas operaciones antes de cambiar de servidor.');
  }
  if (!pending.length) return { pending: 0, accepted: [], conflicts: [] };
  const result = await clientApi('/api/sync/events', { method: 'POST', body: JSON.stringify({ events: pending.map(({ status, conflictReason, serverDeviceId, ...event }) => event) }) });
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  const conflictIds = new Set(conflicts.map(item => String(item.eventId)));
  const accepted = [...(result.accepted || []), ...(result.duplicates || [])].map(String).filter(id => !conflictIds.has(id));
  clientOutbox.acknowledge(accepted);
  for (const conflict of conflicts) clientOutbox.conflict([String(conflict.eventId)], conflict.reason || 'conflicto-servidor');
  if (typeof result.stateHash === 'string') networkConfig.serverStateHash = result.stateHash;
  saveNetworkConfig();
  if (conflicts.length) throw new Error('El servidor detectó conflictos en operaciones LAN. Se detuvo la sincronización del snapshot para evitar sobrescribir registros; revise la cola de operaciones.');
  return { pending: clientOutbox.status().pending, accepted, conflicts };
}
function registerNetworkIpc() {
  ipcMain.handle('network:status', () => ({ ...networkConfig, running: !!networkServer, addresses: localAddresses() }));
  ipcMain.handle('network:operation-create', async (_e, input = {}) => {
    if (networkConfig.role === 'client') {
      const eventType = String(input.eventType || '').trim();
      const entityType = String(input.entityType || '').trim();
      const entityId = String(input.entityId || '').trim();
      if (!eventType || !entityType || !entityId || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('Operación incompleta: tipo, entidad, identificador y payload son obligatorios.');
      const event = clientOutbox.enqueue({ ...input, eventType, entityType, entityId, serverDeviceId: networkConfig.serverDeviceId });
      let deliveryError = '';
      try { await flushClientOutbox(); } catch (error) {
        deliveryError = error.message || String(error);
      }
      const delivery = clientOutbox.get(event.eventId);
      return {
        ...event,
        payload: JSON.stringify(event.payload),
        status: delivery ? delivery.status : 'pending',
        durable: 'client-outbox',
        serverConfirmed: !!delivery && delivery.status === 'acked',
        deliveryError: deliveryError || (delivery && delivery.conflictReason) || ''
      };
    }
    const eventType = String(input.eventType || '').trim();
    const entityType = String(input.entityType || '').trim();
    const entityId = String(input.entityId || '').trim();
    if (!eventType || !entityType || !entityId || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new Error('Operación incompleta: tipo, entidad, identificador y payload son obligatorios.');
    }
    const eventId = String(input.eventId || crypto.randomUUID());
    const occurredAt = String(input.occurredAt || new Date().toISOString());
    const payload = JSON.stringify(input.payload);
    db.run('BEGIN IMMEDIATE');
    try {
      const duplicate = one('SELECT event_id FROM local_operation_outbox WHERE event_id=?', [eventId]);
      if (duplicate) { db.run('COMMIT'); return one('SELECT * FROM local_operation_outbox WHERE event_id=?', [eventId]); }
      run('INSERT OR IGNORE INTO device_sequences(device_id,last_seq) VALUES(?,0)', [networkConfig.deviceId]);
      run('UPDATE device_sequences SET last_seq=last_seq+1 WHERE device_id=?', [networkConfig.deviceId]);
      const seq = Number(one('SELECT last_seq FROM device_sequences WHERE device_id=?', [networkConfig.deviceId]).last_seq);
      run('INSERT INTO local_operation_outbox(event_id,device_id,device_seq,event_type,entity_type,entity_id,occurred_at,payload,status) VALUES(?,?,?,?,?,?,?,?,\'pending\')',
        [eventId, networkConfig.deviceId, seq, eventType, entityType, entityId, occurredAt, payload]);
      db.run('COMMIT');
      persistDb();
      return one('SELECT * FROM local_operation_outbox WHERE event_id=?', [eventId]);
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
  });
  ipcMain.handle('network:operation-pending', () => networkConfig.role === 'client' ? (clientOutbox ? clientOutbox.pending() : []) : all("SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload,status FROM local_operation_outbox WHERE status='pending' ORDER BY device_seq LIMIT 500"));
  ipcMain.handle('network:operation-status', () => networkConfig.role === 'client' ? (clientOutbox ? clientOutbox.status() : { pending: 0, acknowledged: 0, conflicts: 0 }) : ({
    pending: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='pending'").n),
    acknowledged: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='acked'").n),
    conflicts: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='conflict'").n)
  }));
  ipcMain.handle('network:operation-conflicts', () => networkConfig.role === 'client'
    ? (clientOutbox ? clientOutbox.conflicts() : [])
    : all("SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload,status FROM local_operation_outbox WHERE status='conflict' ORDER BY device_seq LIMIT 200"));
  ipcMain.handle('network:next-sequence', async (_e, input = {}) => {
    if (networkConfig.role === 'client') {
      if (!networkConfig.host || !networkConfig.token) throw new Error('Cliente sin conexión configurada al servidor.');
      assertLanHost(networkConfig.host);
      return clientApi('/api/sequences/next', { method: 'POST', body: JSON.stringify({ cashbox: input.cashbox, operation: input.operation, minimum: input.minimum }), timeoutMs: 8000 });
    }
    return allocateCashboxSequence(input.cashbox, input.operation, input.minimum);
  });
  ipcMain.handle('network:discover', () => discoverLanServers());
  ipcMain.handle('network:configure-server', (_e, opts = {}) => startLanServer(opts.port));
  ipcMain.handle('network:stop-server', async () => {
    if (networkServer) await new Promise(resolve => networkServer.close(resolve));
    networkServer = null;
    stopDiscoveryServer();
    if (networkConfig.role === 'server') networkConfig.role = 'standalone';
    saveNetworkConfig();
    return { ...networkConfig, running: false, addresses: localAddresses() };
  });
  ipcMain.handle('network:disconnect-client', async () => {
    if (networkConfig.role === 'client') {
      if (db) { try { db.close(); } catch {} db = null; }
      networkConfig = { ...networkConfig, role: 'client', host: '', token: '', serverDeviceId: '', serverCert: '', tlsFingerprint: '', serverStateHash: '', serverPromotionBlocked: true };
    }
    saveNetworkConfig();
    return { ...networkConfig, running: false, disconnected: true, addresses: localAddresses() };
  });
  ipcMain.handle('network:configure-client', async (_e, opts = {}) => {
    const host = String(opts.host || '').trim();
    const port = normalizeLanPort(opts.port || 38760);
    const token = String(opts.token || '').trim();
    const expectedFingerprint = String(opts.fingerprint || '').trim();
    if (!host || !token || !expectedFingerprint) throw new Error('Indica IP, clave de emparejamiento y huella TLS SHA-256 del servidor.');
    assertLanHost(host);
    const peer = await retrievePeerCertificate(host, port, 5000);
    if (!verifyFingerprint(peer.fingerprint, expectedFingerprint)) throw new Error('La huella TLS recibida no coincide con la mostrada físicamente en el servidor. No se enviaron credenciales.');
    const previous = networkConfig;
    networkConfig = { ...networkConfig, role: 'client', host, port, token, serverCert: peer.certificate, tlsFingerprint: peer.fingerprint, serverStateHash: '', serverPromotionBlocked: true };
    let health;
    try { health = await clientApi('/api/health', { timeoutMs: 5000 }); }
    catch (error) { networkConfig = previous; throw error; }
    const pendingForAnotherServer = clientOutbox.pending().some(event => !event.serverDeviceId || event.serverDeviceId !== health.deviceId);
    if (pendingForAnotherServer || clientOutbox.status().conflicts > 0) {
      networkConfig = previous;
      throw new Error('Esta PC conserva operaciones pendientes o conflictos del servidor anterior. No se cambiará de base central hasta conciliarlos.');
    }
    networkConfig.serverDeviceId = health.deviceId;
    try { saveNetworkConfig(); }
    catch (error) { networkConfig = previous; throw error; }
    if (db) { try { db.close(); } catch {} db = null; }
    return { ...networkConfig, running: false, addresses: localAddresses(), connected: true };
  });
  ipcMain.handle('network:sync-now', async (_e, state) => {
    if (networkConfig.role === 'server') {
      if (!networkServer) throw new Error('El servidor no está iniciado.');
      let merged;
      persistMutation(() => {
        const row = one('SELECT payload FROM app_state WHERE id=1');
        merged = mergeStateRecords(row ? JSON.parse(row.payload) : null, state);
        run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
      });
      return { ok: true, state: merged, role: 'server', updatedAt: new Date().toISOString() };
    }
    if (networkConfig.role !== 'client') return { ok: false, state, role: 'standalone', message: 'Esta caja no está conectada a un servidor.' };
    if (!networkConfig.host || !networkConfig.token || !networkConfig.serverCert) throw new Error('Cliente LAN desconectado. No se usará SQLite local como autoridad; vuelva a emparejar con el servidor.');
    assertLanHost(networkConfig.host);
    await flushClientOutbox();
    const result = await clientApi('/api/sync/state', { method: 'POST', body: JSON.stringify({ deviceId: networkConfig.deviceId, state, expectedHash: networkConfig.serverStateHash || '' }), timeoutMs: 8000 });
    networkConfig.serverStateHash = result.stateHash;
    return { ok: true, state: result.state, role: 'client', updatedAt: result.updatedAt };
  });
}
function registerIpc() {
  ipcMain.handle('posdb:get-mode', () => ({ mode: 'sqlite', databasePath: networkConfig.role === 'client' ? null : userDbPath(), source: networkConfig.role === 'client' ? 'lan-server' : 'local' }));
  ipcMain.handle('posdb:set-mode', () => ({ mode: 'sqlite', databasePath: networkConfig.role === 'client' ? null : userDbPath(), source: networkConfig.role === 'client' ? 'lan-server' : 'local' }));
  ipcMain.handle('posdb:load-state', async () => {
    if (networkConfig.role === 'client') {
      if (!networkConfig.host || !networkConfig.token) throw new Error('Este cliente no está conectado al servidor LAN.');
      assertLanHost(networkConfig.host);
      const result = await clientApi('/api/sync/state', { timeoutMs: 8000 });
      networkConfig.serverStateHash = result.stateHash;
      return { mode: 'sqlite', state: result.state, source: 'lan-server' };
    }
    const row = one('SELECT payload FROM app_state WHERE id=1');
    return { mode: 'sqlite', state: row ? JSON.parse(row.payload) : null, source: 'local-server' };
  });
  ipcMain.handle('posdb:save-state', async (_e, state) => {
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    if (networkConfig.role === 'client') {
      if (!networkConfig.host || !networkConfig.token) throw new Error('Cliente sin conexión al servidor; no se guardó la operación.');
      assertLanHost(networkConfig.host);
      const result = await clientApi('/api/sync/state', { method: 'POST', body: JSON.stringify({ deviceId: networkConfig.deviceId, state, expectedHash: networkConfig.serverStateHash || '' }), timeoutMs: 10000 });
      networkConfig.serverStateHash = result.stateHash;
      return { ok: true, durable: 'server-sqlite', serverDeviceId: result.serverDeviceId };
    }
    const payload = JSON.stringify(state);
    // El cambio en memoria se revierte si el archivo no puede persistirse.
    // Así una operación rechazada no reaparece más tarde por un guardado posterior.
    persistMutation(() => run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP', [payload]));
    clearTimeout(saveTimer);
    saveTimer = null;
    return { ok: true, durable: 'sqlite-file' };
  });
  ipcMain.handle('posdb:list-documents', async (_e, filter = {}) => {
    if (networkConfig.role === 'client') {
      const params = new URLSearchParams();
      if (filter.transactionType) params.set('transactionType', String(filter.transactionType));
      if (filter.transactionId) params.set('transactionId', String(filter.transactionId));
      const result = await clientApi('/api/documents' + (params.size ? '?' + params.toString() : ''));
      return result.documents || [];
    }
    if (databaseMode !== 'sqlite') return [];
    const type = filter.transactionType;
    if (type === 'sale' || type === 'purchase') return all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents WHERE transaction_type=? AND transaction_id=? ORDER BY created_at DESC', [type, String(filter.transactionId || '')]);
    return all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents ORDER BY created_at DESC');
  });
  ipcMain.handle('posdb:save-document', async (_e, doc) => {
    if (networkConfig.role === 'client') return clientApi('/api/documents', { method: 'POST', body: JSON.stringify(doc) });
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    if (!doc || !doc.id || !['sale','purchase'].includes(doc.transactionType) || !doc.transactionId || !doc.dataUrl) throw new Error('Documento incompleto.');
    if (String(doc.dataUrl).length > 4_300_000) throw new Error('El archivo supera el límite local de 3 MB.');
    persistMutation(() => run('INSERT OR REPLACE INTO fiscal_documents(id,transaction_type,transaction_id,file_name,mime_type,file_size,sha256,data_url,created_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [String(doc.id), doc.transactionType, String(doc.transactionId), String(doc.fileName || 'documento'), String(doc.mimeType || 'application/octet-stream'), Number(doc.fileSize || 0), String(doc.sha256 || ''), String(doc.dataUrl), String(doc.createdAt || new Date().toISOString()), String(doc.notes || '')]));
    return { ok: true, durable: 'sqlite-file' };
  });
  ipcMain.handle('posdb:get-document', async (_e, id) => {
    if (networkConfig.role === 'client') {
      const result = await clientApi('/api/documents/' + encodeURIComponent(String(id)));
      return result.document || null;
    }
    if (databaseMode !== 'sqlite') return null;
    return one('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,data_url AS dataUrl,created_at AS createdAt,notes FROM fiscal_documents WHERE id=?', [String(id)]);
  });
  ipcMain.handle('posdb:delete-document', async (_e, id) => {
    if (networkConfig.role === 'client') return clientApi('/api/documents/' + encodeURIComponent(String(id)), { method: 'DELETE' });
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    persistMutation(() => run('DELETE FROM fiscal_documents WHERE id=?', [String(id)]));
    return { ok: true, durable: 'sqlite-file' };
  });
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'SIFER 360 Licorería - Punto de Venta e Inventario',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true
    }
  });
  win.maximize();
  Menu.setApplicationMenu(null);
  if (app.isPackaged) win.loadFile(path.join(__dirname, '../dist/index.html'));
  else {
    const distPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distPath)) win.loadFile(distPath);
    else win.loadURL('http://localhost:3000');
  }
  return win;
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });
  app.whenReady().then(async () => {
    readNetworkConfig();
    if (networkConfig.role !== 'client') await initializeDatabase();
    registerIpc();
    registerNetworkIpc();
    if (networkConfig.role === 'server') { try { await startLanServer(networkConfig.port); } catch (error) { networkConfig.role = 'standalone'; saveNetworkConfig(); } }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('No se pudo iniciar SIFER 360', error && error.message ? error.message : String(error));
    app.quit();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearTimeout(saveTimer); if (networkServer) networkServer.close(); stopDiscoveryServer(); persistDb(); });
