const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { buildAccountingSourceEvents } = require('../src/accounting/source-events.cjs');

let db;
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
      const response = Buffer.from(JSON.stringify({ type: 'SIFER360_SERVER_V1', deviceId: networkConfig.deviceId, port: networkConfig.port, name: os.hostname(), addresses: localAddresses() }));
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
        found.set(data.deviceId || host, { host, port: Number(data.port), name: data.name || 'SIFER360', deviceId: data.deviceId, addresses: ips });
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
const MAX_SYNC_BODY = 8 * 1024 * 1024;
function readNetworkConfig() {
  networkConfigPath = path.join(app.getPath('userData'), 'network-mode.json');
  try { networkConfig = { ...networkConfig, ...JSON.parse(fs.readFileSync(networkConfigPath, 'utf8')) }; } catch {}
  if (!networkConfig.deviceId) networkConfig.deviceId = crypto.randomUUID();
  if (!networkConfig.token) networkConfig.token = crypto.randomBytes(24).toString('hex');
  saveNetworkConfig();
}
function saveNetworkConfig() { try { fs.writeFileSync(networkConfigPath, JSON.stringify(networkConfig, null, 2), 'utf8'); } catch {} }
function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const item of (list || [])) if (item.family === 'IPv4' && !item.internal) out.push(item.address);
  return out;
}
function sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'null' }); res.end(JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > MAX_SYNC_BODY) { reject(new Error('La carga de sincronización excede 8 MB.')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON inválido.')); } }); req.on('error', reject); }); }
function mergeStateRecords(base, incoming) {
  if (!base || typeof base !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return base;
  const out = { ...base, ...incoming };
  const arrays = new Set(['sales','purchases','cxc','cxp','cortesZ','kardex','counts','held','movements','returns','voids','openings','retentions','divisas','cashea','customers','clients','suppliers','documents','products']);
  for (const key of arrays) {
    if (!Array.isArray(base[key]) && !Array.isArray(incoming[key])) continue;
    const map = new Map();
    for (const item of [...(base[key] || []), ...(incoming[key] || [])]) {
      const id = item && (item.id ?? item.uuid ?? item.eventId ?? item.no ?? item.number ?? item.code ?? item.sku);
      if (id === undefined || id === null) { map.set(crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'), item); continue; }
      const boxScoped = ['sales','cxc','cortesZ','openings','movements','returns','voids'].includes(key) ? String(item.cashbox || 'sin-caja') + ':' : '';
      const k = boxScoped + String(id);
      const old = map.get(k);
      if (!old || Number(item.updatedAt || item.ts || item.createdAt || 0) >= Number(old.updatedAt || old.ts || old.createdAt || 0)) map.set(k, item);
    }
    out[key] = [...map.values()];
  }
  return out;
}

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
function persistDb() {
  if (!db) return;
  const integrity = databaseIntegrityStatus(db);
  if (integrity !== 'ok') throw new Error('Se impidió guardar SQLite porque integrity_check no devolvió ok: ' + integrity);
  const target = userDbPath();
  const temporary = target + '.tmp';
  const backup = target + '.bak';
  const backupTemporary = backup + '.tmp';
  const bytes = db.export();
  fs.writeFileSync(temporary, Buffer.from(bytes));
  if (fs.existsSync(target)) {
    fs.copyFileSync(target, backupTemporary);
    fs.renameSync(backupTemporary, backup);
  }
  fs.renameSync(temporary, target);
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

function insertAccountingSourceEvents(events) {
  for (const event of events || []) {
    run(`INSERT OR IGNORE INTO accounting_source_events
      (event_id,source_type,source_id,event_type,occurred_at,payload_hash,payload_json,processing_status)
      VALUES(?,?,?,?,?,?,?,'pending')`,
      [event.eventId,event.sourceType,event.sourceId,event.eventType,event.occurredAt,event.payloadHash,event.payloadJson]);
  }
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
    CREATE TABLE IF NOT EXISTS device_sequences (
      device_id TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_received_operations_device_seq ON network_received_operations(device_id, device_seq);
  `);

  // Migración contable aditiva e idempotente sobre la misma base SQLite local.
  // El archivo se incluye expresamente en el paquete Windows.
  const accountingSchemaPath = path.join(app.getAppPath(), 'src', 'accounting', 'schema.sql');
  if (!fs.existsSync(accountingSchemaPath)) {
    throw new Error('No se encontró el esquema contable incluido en la aplicación: ' + accountingSchemaPath);
  }
  db.run('BEGIN IMMEDIATE');
  try {
    db.run(fs.readFileSync(accountingSchemaPath, 'utf8'));
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw new Error('No se pudo aplicar la migración contable SQLite; la transacción fue revertida. Detalle: ' + (error && error.message ? error.message : String(error)));
  }
  persistDb();
}
async function initializeDatabase() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve('sql.js/dist/' + file) });
  const file = userDbPath();
  if (fs.existsSync(file)) {
    try { db = new SQL.Database(new Uint8Array(fs.readFileSync(file))); }
    catch (error) {
      throw new Error('No se pudo abrir la base SQLite existente. El archivo original se conserva sin sobrescribir. Si existe, revise el respaldo automático ' + file + '.bak. Detalle: ' + (error && error.message ? error.message : String(error)));
    }
    const integrity = databaseIntegrityStatus(db);
    if (integrity !== 'ok') {
      const backup = file + '.bak';
      if (!fs.existsSync(backup)) throw new Error('La base SQLite no superó integrity_check (' + integrity + ') y no existe respaldo automático. Se conserva el archivo original: ' + file);
      let restored;
      try { restored = new SQL.Database(new Uint8Array(fs.readFileSync(backup))); }
      catch (error) { throw new Error('SQLite está corrupta y el respaldo tampoco se puede abrir. Se conservan ambos archivos para recuperación manual.'); }
      const backupIntegrity = databaseIntegrityStatus(restored);
      if (backupIntegrity !== 'ok') throw new Error('SQLite y su respaldo fallaron integrity_check. No se sobrescribió ninguno de los dos archivos.');
      fs.renameSync(file, file + '.corrupt-' + Date.now());
      fs.copyFileSync(backup, file);
      db = restored;
    }
  } else db = new SQL.Database();
  initializeSchema();
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
  const port = Math.max(1024, Math.min(65535, Number(requestedPort || networkConfig.port || 38760)));
  if (networkServer) await new Promise(resolve => networkServer.close(resolve));
  networkConfig = { ...networkConfig, role: 'server', host: '', port, token: networkConfig.token || crypto.randomBytes(24).toString('hex') };
  saveNetworkConfig();
  networkServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
    if (req.headers.authorization !== 'Bearer ' + networkConfig.token) return sendJson(res, 401, { error: 'No autorizado' });
    if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, deviceId: networkConfig.deviceId, role: 'server', protocol: 1 });
    if (url.pathname === '/api/sync/events' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (!body || !Array.isArray(body.events) || body.events.length > 500) return sendJson(res, 400, { error: 'Lote inválido (máximo 500 operaciones).' });
        const accepted = [], duplicates = [], conflicts = [];
        db.run('BEGIN IMMEDIATE');
        try {
          for (const ev of body.events) {
            if (!ev || !ev.eventId || !ev.deviceId || !Number.isSafeInteger(Number(ev.deviceSeq)) || Number(ev.deviceSeq) < 1 || !ev.eventType || !ev.entityType || !ev.entityId || !ev.payload || typeof ev.payload !== 'object') {
              throw new Error('Operación inválida.');
            }
            const existing = one('SELECT event_id FROM network_received_operations WHERE event_id=?', [String(ev.eventId)]);
            const seqOwner = one('SELECT event_id FROM network_received_operations WHERE device_id=? AND device_seq=?', [String(ev.deviceId), Number(ev.deviceSeq)]);
            if (existing) { duplicates.push(String(ev.eventId)); continue; }
            if (seqOwner) { conflicts.push({ eventId: String(ev.eventId), reason: 'device-sequence-already-used', existingEventId: seqOwner.event_id }); continue; }
            run('INSERT INTO network_received_operations(event_id,device_id,device_seq,event_type,entity_type,entity_id,occurred_at,payload) VALUES(?,?,?,?,?,?,?,?)',
              [String(ev.eventId), String(ev.deviceId), Number(ev.deviceSeq), String(ev.eventType), String(ev.entityType), String(ev.entityId), String(ev.occurredAt || new Date().toISOString()), JSON.stringify(ev.payload)]);
            const collection = String(ev.entityType);
            const record = ev.payload && ev.payload.record;
            const allowedCollections = new Set(['sales','purchases','cxc','cxp','cortesZ','kardex','counts','held','casheaMovimientos','casheaLiquidaciones','cambiosDivisas','retencionesIva','retentions','returns','voids']);
            if (allowedCollections.has(collection) && record && typeof record === 'object' && !Array.isArray(record)) {
              const stateRow = one('SELECT payload FROM app_state WHERE id=1');
              let state = stateRow ? JSON.parse(stateRow.payload) : {};
              const records = Array.isArray(state[collection]) ? state[collection] : [];
              const recordId = String(ev.entityId);
              const boxScopedCollections = new Set(['sales','cxc','cortesZ','openings','movements','returns','voids']);
              const recordIdentity = item => {
                const id = String(item.id ?? item.uuid ?? item.eventId ?? item.no ?? item.number ?? item.ctrlNo ?? item.code ?? '');
                return boxScopedCollections.has(collection) ? String(item.cashbox || 'sin-caja') + ':' + id : id;
              };
              const incomingIdentity = boxScopedCollections.has(collection)
                ? String(record.cashbox || 'sin-caja') + ':' + recordId
                : recordId;
              const existingRecord = records.find(item => item && recordIdentity(item) === incomingIdentity);
              if (!existingRecord) {
                const nextState = { ...state, [collection]: [...records, record] };
                insertAccountingSourceEvents(buildAccountingSourceEvents(state, nextState, { deviceId: String(ev.deviceId) }));
                state = nextState;
                run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(state)]);
              } else if (JSON.stringify(existingRecord) !== JSON.stringify(record)) {
                conflicts.push({ eventId: String(ev.eventId), reason: 'entity-already-exists-with-different-data', entityType: collection, entityId: recordId });
              }
            }
            accepted.push(String(ev.eventId));
          }
          db.run('COMMIT');
        } catch (error) { db.run('ROLLBACK'); throw error; }
        persistDb();
        return sendJson(res, 200, { ok: true, accepted, duplicates, conflicts, note: 'Las operaciones se almacenan como eventos; todavía no modifican automáticamente los saldos del POS.' });
      } catch (error) { return sendJson(res, 400, { error: error.message || 'Error recibiendo operaciones' }); }
    }
    if (url.pathname === '/api/sync/events' && req.method === 'GET') {
      const events = all('SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload FROM network_received_operations ORDER BY received_at LIMIT 1000').map(ev => ({ ...ev, payload: JSON.parse(ev.payload) }));
      return sendJson(res, 200, { ok: true, events });
    }
    if (url.pathname === '/api/sync/state' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (!body || typeof body.state !== 'object' || !body.deviceId) return sendJson(res, 400, { error: 'Paquete incompleto' });
        const incoming = body.state;
        const existing = one('SELECT payload FROM app_state WHERE id=1');
        const current = existing ? JSON.parse(existing.payload) : {};
        const merged = mergeStateRecords(current, incoming);
        const accountingEvents = buildAccountingSourceEvents(current, merged, { deviceId: String(body.deviceId) });
        const eventId = String(body.deviceId) + '-' + crypto.createHash('sha256').update(JSON.stringify(incoming)).digest('hex');
        db.run('BEGIN IMMEDIATE');
        try {
          run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
          insertAccountingSourceEvents(accountingEvents);
          run('INSERT OR IGNORE INTO network_sync_events(event_id,device_id,created_at,payload) VALUES(?,?,?,?)', [eventId, String(body.deviceId), new Date().toISOString(), JSON.stringify({ state: incoming })]);
          db.run('COMMIT');
        } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
        persistDb();
        return sendJson(res, 200, { ok: true, state: merged, serverDeviceId: networkConfig.deviceId, updatedAt: new Date().toISOString() });
      } catch (error) { return sendJson(res, 400, { error: error.message || 'Error sincronizando' }); }
    }
    if (url.pathname === '/api/sync/state' && req.method === 'GET') {
      const row = one('SELECT payload FROM app_state WHERE id=1');
      return sendJson(res, 200, { ok: true, state: row ? JSON.parse(row.payload) : null, serverDeviceId: networkConfig.deviceId, updatedAt: new Date().toISOString() });
    }
    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  });
  await new Promise((resolve, reject) => { networkServer.once('error', reject); networkServer.listen(port, '0.0.0.0', () => { networkServer.removeListener('error', reject); resolve(); }); });
  startDiscoveryServer();
  return { ...networkConfig, running: true, addresses: localAddresses() };
}
function registerNetworkIpc() {
  ipcMain.handle('network:status', () => ({ ...networkConfig, running: !!networkServer, addresses: localAddresses() }));
  ipcMain.handle('network:operation-create', (_e, input = {}) => {
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
  ipcMain.handle('network:operation-pending', () => all("SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload,status FROM local_operation_outbox WHERE status='pending' ORDER BY device_seq LIMIT 500"));
  ipcMain.handle('network:operation-status', () => ({
    pending: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='pending'").n),
    acknowledged: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='acked'").n),
    conflicts: Number(one("SELECT COUNT(*) AS n FROM local_operation_outbox WHERE status='conflict'").n)
  }));
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
  ipcMain.handle('network:configure-client', async (_e, opts = {}) => {
    const host = String(opts.host || '').trim();
    const port = Math.max(1024, Math.min(65535, Number(opts.port || 38760)));
    const token = String(opts.token || '').trim();
    if (!host || !token) throw new Error('Indica IP del servidor y clave de emparejamiento.');
    const response = await fetch('http://' + host + ':' + port + '/api/health', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('No se pudo autenticar con el servidor (' + response.status + ').');
    const health = await response.json();
    networkConfig = { ...networkConfig, role: 'client', host, port, token, serverDeviceId: health.deviceId };
    saveNetworkConfig();
    return { ...networkConfig, running: false, addresses: localAddresses(), connected: true };
  });
  ipcMain.handle('network:sync-now', async (_e, state) => {
    if (networkConfig.role === 'server') {
      if (!networkServer) throw new Error('El servidor no está iniciado.');
      const row = one('SELECT payload FROM app_state WHERE id=1');
      const merged = mergeStateRecords(row ? JSON.parse(row.payload) : null, state);
      run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
      persistDb();
      return { ok: true, state: merged, role: 'server', updatedAt: new Date().toISOString() };
    }
    if (networkConfig.role !== 'client' || !networkConfig.host) return { ok: false, state, role: 'standalone', message: 'Esta caja no está conectada a un servidor.' };
    const headers = { Authorization: 'Bearer ' + networkConfig.token, 'Content-Type': 'application/json' };
    const pendingEvents = all("SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,occurred_at AS occurredAt,payload FROM local_operation_outbox WHERE status='pending' ORDER BY device_seq LIMIT 500").map(ev => ({ ...ev, payload: JSON.parse(ev.payload) }));
    if (pendingEvents.length) {
      const eventResponse = await fetch('http://' + networkConfig.host + ':' + networkConfig.port + '/api/sync/events', {
        method: 'POST', headers, body: JSON.stringify({ events: pendingEvents }), signal: AbortSignal.timeout(8000)
      });
      if (!eventResponse.ok) throw new Error('Servidor rechazó operaciones pendientes (' + eventResponse.status + ').');
      const eventResult = await eventResponse.json();
      db.run('BEGIN IMMEDIATE');
      try {
        const conflictIds = new Set((eventResult.conflicts || []).map(conflict => String(conflict.eventId)));
        for (const id of [...(eventResult.accepted || []), ...(eventResult.duplicates || [])]) {
          if (!conflictIds.has(String(id))) run("UPDATE local_operation_outbox SET status='acked',acked_at=? WHERE event_id=?", [new Date().toISOString(), String(id)]);
        }
        for (const conflict of (eventResult.conflicts || [])) run("UPDATE local_operation_outbox SET status='conflict' WHERE event_id=?", [String(conflict.eventId)]);
        db.run('COMMIT');
      } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
      persistDb();
    }
    const endpoint = 'http://' + networkConfig.host + ':' + networkConfig.port + '/api/sync/state';
    const pushed = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ deviceId: networkConfig.deviceId, state }), signal: AbortSignal.timeout(8000) });
    if (!pushed.ok) throw new Error('Servidor rechazó la sincronización (' + pushed.status + ').');
    const result = await pushed.json();
    return { ok: true, state: result.state, role: 'client', updatedAt: result.updatedAt };
  });
}

function assertTrustedAccountingSender(event) {
  const rawUrl = event && event.senderFrame && event.senderFrame.url;
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch { throw new Error('Origen IPC no válido.'); }
  if (app.isPackaged) {
    if (parsed.protocol !== 'file:' || !parsed.pathname.replace(/\\\\/g, '/').endsWith('/dist/index.html')) {
      throw new Error('Se rechazó una solicitud contable desde un origen no autorizado.');
    }
  } else if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Se rechazó una solicitud contable desde un origen no autorizado.');
  }
}
function accountingActor(input) {
  const actorId = String(input && input.actorId || '').trim().slice(0, 100);
  const actorRole = String(input && input.actorRole || '').trim();
  if (!actorId || !['admin', 'contador'].includes(actorRole)) {
    throw new Error('Esta operación requiere un usuario Administrador o Contador identificado.');
  }
  return { actorId, actorRole };
}
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(String(value) + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
let accountingEngineModule;
async function loadAccountingEngine() {
  if (!accountingEngineModule) accountingEngineModule = await import('../src/accounting/engine.mjs');
  return accountingEngineModule;
}
function accountingJournalWithLines(entryId) {
  const row = one('SELECT * FROM journal_entries WHERE id=?', [entryId]);
  if (!row) return null;
  const lines = all('SELECT account_code AS accountCode,debit_minor AS debitMinor,credit_minor AS creditMinor,description,third_party_id AS thirdPartyId,cost_center AS costCenter FROM journal_lines WHERE entry_id=? ORDER BY line_no', [entryId]);
  return {
    id:row.id,sourceType:row.source_type,sourceId:row.source_id,entryDate:row.entry_date,periodId:row.period_id,
    currency:row.functional_currency,ruleVersion:row.rule_version,description:row.description,status:row.status,
    debitMinor:Number(row.debit_minor),creditMinor:Number(row.credit_minor),createdAt:row.created_at,createdBy:row.created_by,
    approvedAt:row.approved_at,approvedBy:row.approved_by,postedAt:row.posted_at,postedBy:row.posted_by,
    reversesEntryId:row.reverses_entry_id,lines
  };
}
function insertJournalEntry(entry) {
  run(`INSERT INTO journal_entries(id,source_type,source_id,entry_date,period_id,functional_currency,rule_version,description,status,debit_minor,credit_minor,created_at,created_by,approved_at,approved_by,posted_at,posted_by,reverses_entry_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entry.id,entry.sourceType,entry.sourceId,entry.entryDate,entry.periodId,entry.currency,entry.ruleVersion,entry.description,entry.status,
      entry.debitMinor,entry.creditMinor,entry.createdAt,entry.createdBy,entry.approvedAt,entry.approvedBy,entry.postedAt,entry.postedBy,entry.reversesEntryId]);
  entry.lines.forEach((line,index)=>run('INSERT INTO journal_lines(id,entry_id,line_no,account_code,debit_minor,credit_minor,description,third_party_id,cost_center) VALUES(?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),entry.id,index+1,line.accountCode,line.debitMinor,line.creditMinor,line.description||'',line.thirdPartyId||null,line.costCenter||null]));
}

function registerAccountingIpc() {
  ipcMain.handle('accounting:get-settings', event => {
    assertTrustedAccountingSender(event);
    return one('SELECT accounting_framework AS accountingFramework,functional_currency AS functionalCurrency,presentation_currency AS presentationCurrency,monetary_decimals AS monetaryDecimals,automation_mode AS automationMode,policy_version AS policyVersion,updated_at AS updatedAt,updated_by AS updatedBy FROM accounting_settings WHERE id=1');
  });
  ipcMain.handle('accounting:save-settings', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const framework = String(input.accountingFramework || '');
    const functionalCurrency = String(input.functionalCurrency || '').trim().toUpperCase();
    const presentationCurrency = String(input.presentationCurrency || '').trim().toUpperCase();
    const decimals = Number(input.monetaryDecimals);
    const automation = String(input.automationMode || 'supervised');
    const policyVersion = String(input.policyVersion || '').trim();
    if (!['VEN_NIF_PYME', 'VEN_NIF_GE'].includes(framework)) throw new Error('Selecciona VEN-NIF PYME o VEN-NIF GE según la clasificación documentada.');
    if (!/^[A-Z]{3}$/.test(functionalCurrency) || !/^[A-Z]{3}$/.test(presentationCurrency)) throw new Error('Indica códigos ISO 4217 válidos para moneda funcional y de presentación.');
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) throw new Error('Los decimales monetarios deben estar entre 0 y 6.');
    if (!['supervised', 'suggest_only'].includes(automation)) throw new Error('Modo de automatización no válido.');
    if (!policyVersion || policyVersion.length > 80) throw new Error('Indica la versión de política contable aprobada.');
    const now = new Date().toISOString();
    const before = one('SELECT * FROM accounting_settings WHERE id=1');
    db.run('BEGIN IMMEDIATE');
    try {
      run(`INSERT INTO accounting_settings(id,accounting_framework,functional_currency,presentation_currency,monetary_decimals,automation_mode,policy_version,updated_at,updated_by)
        VALUES(1,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET accounting_framework=excluded.accounting_framework,functional_currency=excluded.functional_currency,presentation_currency=excluded.presentation_currency,monetary_decimals=excluded.monetary_decimals,automation_mode=excluded.automation_mode,policy_version=excluded.policy_version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
        [framework, functionalCurrency, presentationCurrency, decimals, automation, policyVersion, now, actor.actorId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(), 'accounting_settings', '1', 'update', actor.actorId, now, before ? JSON.stringify(before) : null, JSON.stringify({ accountingFramework: framework, functionalCurrency, presentationCurrency, monetaryDecimals: decimals, automationMode: automation, policyVersion })]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return one('SELECT accounting_framework AS accountingFramework,functional_currency AS functionalCurrency,presentation_currency AS presentationCurrency,monetary_decimals AS monetaryDecimals,automation_mode AS automationMode,policy_version AS policyVersion,updated_at AS updatedAt,updated_by AS updatedBy FROM accounting_settings WHERE id=1');
  });
  ipcMain.handle('accounting:get-profile', event => {
    assertTrustedAccountingSender(event);
    return one('SELECT * FROM fiscal_entity_profile WHERE id=1');
  });
  ipcMain.handle('accounting:save-profile', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const rif = String(input.rif || '').trim().toUpperCase();
    const legalName = String(input.legalName || '').trim();
    const classification = String(input.taxpayerClassification || 'unknown');
    const activity = String(input.businessActivityScope || 'unknown');
    const emission = String(input.invoiceEmissionMode || 'internal_only');
    if (!/^[JGVEP]-?\d{8}-?\d$/.test(rif)) throw new Error('El RIF debe tener formato válido, por ejemplo J-12345678-9.');
    if (!legalName || legalName.length > 180) throw new Error('Indica la razón social registrada en el RIF.');
    if (!['unknown','ordinary','formal','special'].includes(classification)) throw new Error('Clasificación tributaria no válida.');
    if (!['unknown','retail','wholesale','importer','manufacturer','producer','mixed'].includes(activity)) throw new Error('Actividad económica no válida.');
    if (!['internal_only','official_portal','authorized_provider','fiscal_machine','contingency'].includes(emission)) throw new Error('Modalidad de emisión no válida.');
    const special = input.specialSubjectConfirmed === true ? 1 : 0;
    const withholding = input.ivaWithholdingAgentConfirmed === true ? 1 : 0;
    if ((classification === 'special') !== (special === 1)) throw new Error('La clasificación especial debe coincidir con la notificación expresa verificada.');
    if (withholding && !special) throw new Error('No se puede activar agente de retención IVA sin designación especial confirmada.');
    const perception = input.ivaPerceptionAgentConfirmed === true ? 1 : 0;
    if (special && (!String(input.specialNoticeReference || '').trim() || !input.specialNoticeDate)) throw new Error('La condición de sujeto pasivo especial exige referencia y fecha de notificación.');
    if (emission === 'authorized_provider' && (!String(input.providerRif || '').trim() || !String(input.providerAuthorizationReference || '').trim())) throw new Error('El proveedor tecnológico requiere RIF y autorización verificables.');
    if (emission === 'fiscal_machine' && !String(input.fiscalMachineSerial || '').trim()) throw new Error('La máquina fiscal requiere serial verificable.');
    const now = new Date().toISOString();
    const before = one('SELECT * FROM fiscal_entity_profile WHERE id=1');
    db.run('BEGIN IMMEDIATE');
    try {
      run(`INSERT INTO fiscal_entity_profile(id,rif,legal_name,taxpayer_classification,special_subject_confirmed,special_notice_reference,special_notice_date,iva_withholding_agent_confirmed,iva_perception_agent_confirmed,business_activity_scope,alcohol_license_reference,municipal_license_reference,invoice_emission_mode,provider_rif,provider_authorization_reference,fiscal_machine_serial,valid_from,valid_to,updated_at,updated_by)
        VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET rif=excluded.rif,legal_name=excluded.legal_name,taxpayer_classification=excluded.taxpayer_classification,special_subject_confirmed=excluded.special_subject_confirmed,special_notice_reference=excluded.special_notice_reference,special_notice_date=excluded.special_notice_date,iva_withholding_agent_confirmed=excluded.iva_withholding_agent_confirmed,iva_perception_agent_confirmed=excluded.iva_perception_agent_confirmed,business_activity_scope=excluded.business_activity_scope,alcohol_license_reference=excluded.alcohol_license_reference,municipal_license_reference=excluded.municipal_license_reference,invoice_emission_mode=excluded.invoice_emission_mode,provider_rif=excluded.provider_rif,provider_authorization_reference=excluded.provider_authorization_reference,fiscal_machine_serial=excluded.fiscal_machine_serial,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
        [rif,legalName,classification,special,String(input.specialNoticeReference||''),String(input.specialNoticeDate||''),withholding,perception,activity,String(input.alcoholLicenseReference||''),String(input.municipalLicenseReference||''),emission,String(input.providerRif||''),String(input.providerAuthorizationReference||''),String(input.fiscalMachineSerial||''),String(input.validFrom||''),String(input.validTo||''),now,actor.actorId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'fiscal_entity_profile','1','update',actor.actorId,now,before?JSON.stringify(before):null,JSON.stringify({rif,legalName,taxpayerClassification:classification,specialSubjectConfirmed:special,ivaWithholdingAgentConfirmed:withholding,ivaPerceptionAgentConfirmed:perception,businessActivityScope:activity,invoiceEmissionMode:emission})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return one('SELECT * FROM fiscal_entity_profile WHERE id=1');
  });
  ipcMain.handle('accounting:list-source-events', event => {
    assertTrustedAccountingSender(event);
    return all(`SELECT event_id AS eventId,source_type AS sourceType,source_id AS sourceId,event_type AS eventType,
      occurred_at AS occurredAt,processing_status AS processingStatus,error_message AS errorMessage,payload_json AS payloadJson
      FROM accounting_source_events ORDER BY occurred_at DESC LIMIT 100`).map(row => {
        let payload = null; try { payload = JSON.parse(row.payloadJson); } catch {}
        delete row.payloadJson;
        return { ...row, payload };
      });
  });
  ipcMain.handle('accounting:mark-source-event-review', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const eventId = String(input.eventId || '').trim();
    const reason = String(input.reason || '').trim().slice(0, 1000);
    if (!eventId || !reason) throw new Error('Selecciona el evento e indica el motivo de revisión.');
    const before = one('SELECT event_id,source_type,source_id,event_type,processing_status FROM accounting_source_events WHERE event_id=?', [eventId]);
    if (!before) throw new Error('El evento contable no existe.');
    if (!['pending','needs_review'].includes(before.processing_status)) throw new Error('Solo se pueden marcar eventos pendientes o ya en revisión.');
    const now = new Date().toISOString();
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE accounting_source_events SET processing_status='needs_review',error_message=? WHERE event_id=?", [reason,eventId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_source_event',eventId,'mark_needs_review',actor.actorId,now,reason,JSON.stringify(before),JSON.stringify({processingStatus:'needs_review',reason})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return one('SELECT event_id AS eventId,processing_status AS processingStatus,error_message AS errorMessage FROM accounting_source_events WHERE event_id=?',[eventId]);
  });
  ipcMain.handle('accounting:source-event-summary', event => {
    assertTrustedAccountingSender(event);
    const rows = all('SELECT processing_status AS status,COUNT(*) AS total FROM accounting_source_events GROUP BY processing_status');
    const summary = { pending: 0, processed: 0, rejected: 0, needs_review: 0, total: 0 };
    for (const row of rows) { summary[row.status] = Number(row.total); summary.total += Number(row.total); }
    return summary;
  });
  ipcMain.handle('accounting:list-periods', event => {
    assertTrustedAccountingSender(event);
    return all('SELECT id,label,start_date AS startDate,end_date AS endDate,status,closed_at AS closedAt,closed_by AS closedBy FROM accounting_periods ORDER BY start_date');
  });
  ipcMain.handle('accounting:save-period', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const id = String(input.id || '').trim();
    const label = String(input.label || '').trim();
    const startDate = String(input.startDate || '');
    const endDate = String(input.endDate || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(id) || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate || !label || startDate.slice(0,7)!==id || endDate.slice(0,7)!==id) throw new Error('Período inválido: el identificador AAAA-MM debe coincidir con las fechas de inicio y fin.');
    const overlap = one('SELECT id FROM accounting_periods WHERE id<>? AND start_date<=? AND end_date>=? LIMIT 1', [id,endDate,startDate]);
    if (overlap) throw new Error('El período se solapa con el período contable ' + overlap.id + '.');
    const existing = one('SELECT status FROM accounting_periods WHERE id=?', [id]);
    if (existing && existing.status === 'closed') throw new Error('Un período cerrado no puede modificarse.');
    const now = new Date().toISOString();
    db.run('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO accounting_periods(id,label,start_date,end_date,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,start_date=excluded.start_date,end_date=excluded.end_date', [id,label,startDate,endDate,'open']);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_period',id,existing?'update':'create',actor.actorId,now,existing?JSON.stringify(existing):null,JSON.stringify({label,startDate,endDate})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return one('SELECT id,label,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [id]);
  });

  ipcMain.handle('accounting:list-journal-entries', event => {
    assertTrustedAccountingSender(event);
    return all(`SELECT id,source_type AS sourceType,source_id AS sourceId,entry_date AS entryDate,period_id AS periodId,
      functional_currency AS currency,description,status,debit_minor AS debitMinor,credit_minor AS creditMinor,
      created_by AS createdBy,approved_by AS approvedBy,posted_by AS postedBy,reverses_entry_id AS reversesEntryId
      FROM journal_entries ORDER BY entry_date DESC,created_at DESC LIMIT 100`);
  });
  ipcMain.handle('accounting:get-trial-balance', event => {
    assertTrustedAccountingSender(event);
    return all(`SELECT a.code,a.name,a.account_type AS accountType,a.normal_balance AS normalBalance,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.debit_minor ELSE 0 END),0) AS debitMinor,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.credit_minor ELSE 0 END),0) AS creditMinor
      FROM chart_of_accounts a LEFT JOIN journal_lines l ON l.account_code=a.code
      LEFT JOIN journal_entries j ON j.id=l.entry_id
      GROUP BY a.code,a.name,a.account_type,a.normal_balance ORDER BY a.code`);
  });
  ipcMain.handle('accounting:create-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const settings = one('SELECT accounting_framework,functional_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
    if (!settings || !settings.accounting_framework || !settings.functional_currency) throw new Error('Configura primero el marco VEN-NIF y la moneda funcional.');
    const entryDate = String(input.entryDate || '');
    const periodId = String(input.periodId || '');
    const description = String(input.description || '').trim().slice(0,500);
    if (!isValidIsoDate(entryDate) || !periodId || !description) throw new Error('Fecha, período y descripción son obligatorios.');
    const period = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[periodId]);
    if (!period || period.status !== 'open') throw new Error('El asiento requiere un período contable abierto.');
    if (entryDate < period.startDate || entryDate > period.endDate) throw new Error('La fecha del asiento está fuera del período seleccionado.');
    if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 100) throw new Error('El asiento debe contener entre 2 y 100 renglones.');
    const { createJournalEntry, decimalToMinorUnits } = await loadAccountingEngine();
    const lines = input.lines.map(line => {
      const code = String(line.accountCode || '').trim();
      const account = one('SELECT active,accepts_posting,framework_scope FROM chart_of_accounts WHERE code=?',[code]);
      if (!account || Number(account.active)!==1 || Number(account.accepts_posting)!==1) throw new Error('La cuenta '+code+' no existe, está inactiva o es de agrupación.');
      if (account.framework_scope!=='both' && account.framework_scope!==settings.accounting_framework) throw new Error('La cuenta '+code+' no aplica al marco VEN-NIF configurado.');
      return {
        accountCode:code,
        debitMinor:decimalToMinorUnits(String(line.debit || '0'),Number(settings.monetary_decimals)),
        creditMinor:decimalToMinorUnits(String(line.credit || '0'),Number(settings.monetary_decimals)),
        description:String(line.description||'').trim().slice(0,180)
      };
    });
    const id=crypto.randomUUID();
    const entry=createJournalEntry({id,sourceType:'manual',sourceId:id,entryDate,periodId,currency:settings.functional_currency,
      ruleVersion:String(settings.policy_version)+' / MANUAL-v1',description,lines,createdAt:new Date().toISOString(),createdBy:actor.actorId});
    db.run('BEGIN IMMEDIATE');
    try {
      insertJournalEntry(entry);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',id,'create_draft',actor.actorId,entry.createdAt,JSON.stringify({sourceType:entry.sourceType,entryDate,periodId,description,debitMinor:entry.debitMinor,creditMinor:entry.creditMinor})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return accountingJournalWithLines(id);
  });
  ipcMain.handle('accounting:approve-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La aprobación de asientos está reservada al perfil Contador.');
    const entry=accountingJournalWithLines(String(input.entryId||''));
    if(!entry)throw new Error('El asiento no existe.');
    if(entry.createdBy===actor.actorId)throw new Error('El creador del asiento no puede aprobar su propio asiento.');
    const { approveJournalEntry }=await loadAccountingEngine();
    const approved=approveJournalEntry(entry,{actorId:actor.actorId,actorRole:actor.actorRole});
    const now=approved.approvedAt;
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE journal_entries SET status='approved',approved_at=?,approved_by=? WHERE id=? AND status='draft'",[now,actor.actorId,entry.id]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',entry.id,'approve',actor.actorId,now,JSON.stringify({status:entry.status}),JSON.stringify({status:'approved'})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistDb();
    return accountingJournalWithLines(entry.id);
  });
  ipcMain.handle('accounting:post-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La contabilización está reservada al perfil Contador.');
    const entry=accountingJournalWithLines(String(input.entryId||''));
    if(!entry)throw new Error('El asiento no existe.');
    const periodRow=one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[entry.periodId]);
    const { postJournalEntry }=await loadAccountingEngine();
    const posted=postJournalEntry(entry,periodRow,{actorId:actor.actorId});
    const settings=one('SELECT accounting_framework,functional_currency FROM accounting_settings WHERE id=1');
    for(const line of entry.lines){
      const account=one('SELECT active,accepts_posting,framework_scope FROM chart_of_accounts WHERE code=?',[line.accountCode]);
      if(!account||Number(account.active)!==1||Number(account.accepts_posting)!==1||(account.framework_scope!=='both'&&account.framework_scope!==settings.accounting_framework))throw new Error('La cuenta '+line.accountCode+' ya no está habilitada para contabilizar.');
    }
    const now=posted.postedAt;
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE journal_entries SET status='posted',posted_at=?,posted_by=? WHERE id=? AND status='approved'",[now,actor.actorId,entry.id]);
      if(entry.reversesEntryId){
        const original=one('SELECT status FROM journal_entries WHERE id=?',[entry.reversesEntryId]);
        if(!original||original.status!=='posted')throw new Error('El asiento original ya no está disponible para reverso.');
        run("UPDATE journal_entries SET status='reversed' WHERE id=? AND status='posted'",[entry.reversesEntryId]);
      }
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',entry.id,'post',actor.actorId,now,JSON.stringify({status:entry.status}),JSON.stringify({status:'posted',reversesEntryId:entry.reversesEntryId})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistDb();
    return accountingJournalWithLines(entry.id);
  });
  ipcMain.handle('accounting:create-reversal-draft', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La creación de reversos está reservada al perfil Contador.');
    const original=accountingJournalWithLines(String(input.entryId||''));
    if(!original||original.status!=='posted')throw new Error('Solo se puede reversar un asiento contabilizado.');
    const reason=String(input.reason||'').trim().slice(0,500);
    const reversalDate=String(input.reversalDate||'');
    const reversalPeriodId=String(input.reversalPeriodId||'');
    const period=one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[reversalPeriodId]);
    if(!reason||!isValidIsoDate(reversalDate)||!period||period.status!=='open'||reversalDate<period.startDate||reversalDate>period.endDate)throw new Error('Motivo, fecha y período abierto del reverso son obligatorios y deben ser coherentes.');
    const { reverseJournalEntry }=await loadAccountingEngine();
    const reversal=reverseJournalEntry(original,{id:crypto.randomUUID(),reason,actorId:actor.actorId,reversalDate,reversalPeriodId});
    db.run('BEGIN IMMEDIATE');
    try {
      insertJournalEntry(reversal);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',reversal.id,'create_reversal_draft',actor.actorId,reversal.createdAt,reason,JSON.stringify({originalEntryId:original.id,status:original.status}),JSON.stringify({reversalEntryId:reversal.id,status:'draft',reversalDate,reversalPeriodId})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistDb();
    return accountingJournalWithLines(reversal.id);
  });
  ipcMain.handle('accounting:list-accounts', event => {
    assertTrustedAccountingSender(event);
    return all(`SELECT code,parent_code AS parentCode,name,account_type AS accountType,normal_balance AS normalBalance,
      accepts_posting AS acceptsPosting,active,framework_scope AS frameworkScope,updated_at AS updatedAt
      FROM chart_of_accounts ORDER BY code`);
  });
  ipcMain.handle('accounting:save-account', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const code = String(input.code || '').trim();
    const name = String(input.name || '').trim();
    const accountType = String(input.accountType || '');
    const normalBalance = String(input.normalBalance || '');
    const parentCode = String(input.parentCode || '').trim() || null;
    const frameworkScope = String(input.frameworkScope || 'both');
    const acceptsPosting = input.acceptsPosting === true ? 1 : 0;
    const active = input.active === false ? 0 : 1;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(code)) throw new Error('Código inválido: usa hasta 30 caracteres alfanuméricos, punto, guion o guion bajo.');
    if (!name || name.length > 150) throw new Error('El nombre de la cuenta es obligatorio y admite hasta 150 caracteres.');
    if (!['asset','liability','equity','income','expense','memorandum'].includes(accountType)) throw new Error('Selecciona una clasificación contable válida.');
    if (!['debit','credit'].includes(normalBalance)) throw new Error('Selecciona el saldo normal Debe o Haber.');
    if (!['both','VEN_NIF_PYME','VEN_NIF_GE'].includes(frameworkScope)) throw new Error('Ámbito VEN-NIF no válido.');
    const settings = one('SELECT accounting_framework FROM accounting_settings WHERE id=1');
    if (!settings || !settings.accounting_framework) throw new Error('Primero configura y documenta el marco VEN-NIF de la entidad.');
    if (frameworkScope !== 'both' && frameworkScope !== settings.accounting_framework) throw new Error('El ámbito de la cuenta no coincide con el marco contable configurado.');
    if (parentCode === code) throw new Error('Una cuenta no puede ser su propia cuenta padre.');
    const before = one('SELECT * FROM chart_of_accounts WHERE code=?', [code]);
    const hasLines = Number(one('SELECT COUNT(*) AS total FROM journal_lines WHERE account_code=?', [code]).total) > 0;
    const children = Number(one('SELECT COUNT(*) AS total FROM chart_of_accounts WHERE parent_code=?', [code]).total);
    const activeChildren = Number(one('SELECT COUNT(*) AS total FROM chart_of_accounts WHERE parent_code=? AND active=1', [code]).total);
    if (hasLines && before && (before.account_type !== accountType || before.normal_balance !== normalBalance || (before.parent_code || null) !== parentCode || before.framework_scope !== frameworkScope || Number(before.accepts_posting) !== acceptsPosting)) {
      throw new Error('No se puede cambiar clasificación, saldo normal o jerarquía de una cuenta que ya tiene movimientos contables.');
    }
    if (children > 0 && acceptsPosting) throw new Error('Una cuenta con subcuentas debe ser de agrupación y no aceptar contabilizaciones.');
    if (active === 0 && activeChildren > 0) throw new Error('No se puede inactivar una cuenta que conserva subcuentas activas.');
    if (parentCode) {
      const parent = one('SELECT code,account_type,accepts_posting,active,framework_scope FROM chart_of_accounts WHERE code=?', [parentCode]);
      if (!parent || Number(parent.active) !== 1 || Number(parent.accepts_posting) !== 0) throw new Error('La cuenta padre debe existir, estar activa y ser de agrupación.');
      if (parent.account_type !== accountType) throw new Error('La cuenta hija debe conservar la misma clasificación de su cuenta padre.');
      if (parent.framework_scope !== 'both' && parent.framework_scope !== frameworkScope) throw new Error('La cuenta hija no puede tener un alcance VEN-NIF más amplio que su cuenta padre.');
      const visited = new Set([code]);
      let cursor = parentCode;
      while (cursor) {
        if (visited.has(cursor)) throw new Error('La jerarquía produciría un ciclo de cuentas.');
        visited.add(cursor);
        const ancestor = one('SELECT parent_code FROM chart_of_accounts WHERE code=?', [cursor]);
        cursor = ancestor && ancestor.parent_code ? String(ancestor.parent_code) : null;
      }
    }
    const now = new Date().toISOString();
    db.run('BEGIN IMMEDIATE');
    try {
      run(`INSERT INTO chart_of_accounts(code,parent_code,name,account_type,normal_balance,accepts_posting,active,framework_scope,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET parent_code=excluded.parent_code,name=excluded.name,account_type=excluded.account_type,
          normal_balance=excluded.normal_balance,accepts_posting=excluded.accepts_posting,active=excluded.active,
          framework_scope=excluded.framework_scope,updated_at=excluded.updated_at`,
        [code,parentCode,name,accountType,normalBalance,acceptsPosting,active,frameworkScope,now,now]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'chart_of_account',code,before?'update':'create',actor.actorId,now,before?JSON.stringify(before):null,JSON.stringify({code,parentCode,name,accountType,normalBalance,acceptsPosting,active,frameworkScope})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistDb();
    return one('SELECT code,parent_code AS parentCode,name,account_type AS accountType,normal_balance AS normalBalance,accepts_posting AS acceptsPosting,active,framework_scope AS frameworkScope FROM chart_of_accounts WHERE code=?',[code]);
  });

}

function registerIpc() {
  ipcMain.handle('posdb:get-mode', () => ({ mode: 'sqlite', databasePath: userDbPath() }));
  ipcMain.handle('posdb:set-mode', () => ({ mode: 'sqlite', databasePath: userDbPath() }));
  ipcMain.handle('posdb:load-state', () => {
    const row = one('SELECT payload FROM app_state WHERE id=1');
    return { mode: 'sqlite', state: row ? JSON.parse(row.payload) : null };
  });
  ipcMain.handle('posdb:save-state', (_e, state) => {
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Estado POS inválido.');
    const payload = JSON.stringify(state);
    const currentRow = one('SELECT payload FROM app_state WHERE id=1');
    const previousState = currentRow ? JSON.parse(currentRow.payload) : {};
    const accountingEvents = buildAccountingSourceEvents(previousState, state, { deviceId: networkConfig.deviceId });
    db.run('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP', [payload]);
      insertAccountingSourceEvents(accountingEvents);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    clearTimeout(saveTimer);
    if (accountingEvents.length) {
      // Operación comercial y su evento contable se escriben juntos y se fuerzan al archivo SQLite.
      persistDb();
    } else {
      saveTimer = setTimeout(persistDb, 80);
    }
    return { ok: true, accountingEventsCaptured: accountingEvents.length };
  });
  ipcMain.handle('posdb:list-documents', (_e, filter = {}) => {
    if (databaseMode !== 'sqlite') return [];
    const type = filter.transactionType;
    if (type === 'sale' || type === 'purchase') return all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents WHERE transaction_type=? AND transaction_id=? ORDER BY created_at DESC', [type, String(filter.transactionId || '')]);
    return all('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,created_at AS createdAt,notes FROM fiscal_documents ORDER BY created_at DESC');
  });
  ipcMain.handle('posdb:save-document', (_e, doc) => {
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    if (!doc || !doc.id || !['sale','purchase'].includes(doc.transactionType) || !doc.transactionId || !doc.dataUrl) throw new Error('Documento incompleto.');
    if (String(doc.dataUrl).length > 4_300_000) throw new Error('El archivo supera el límite local de 3 MB.');
    run('INSERT OR REPLACE INTO fiscal_documents(id,transaction_type,transaction_id,file_name,mime_type,file_size,sha256,data_url,created_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [String(doc.id), doc.transactionType, String(doc.transactionId), String(doc.fileName || 'documento'), String(doc.mimeType || 'application/octet-stream'), Number(doc.fileSize || 0), String(doc.sha256 || ''), String(doc.dataUrl), String(doc.createdAt || new Date().toISOString()), String(doc.notes || '')]);
    persistDb();
    return { ok: true };
  });
  ipcMain.handle('posdb:get-document', (_e, id) => {
    if (databaseMode !== 'sqlite') return null;
    return one('SELECT id,transaction_type AS transactionType,transaction_id AS transactionId,file_name AS fileName,mime_type AS mimeType,file_size AS fileSize,sha256,data_url AS dataUrl,created_at AS createdAt,notes FROM fiscal_documents WHERE id=?', [String(id)]);
  });
  ipcMain.handle('posdb:delete-document', (_e, id) => {
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    run('DELETE FROM fiscal_documents WHERE id=?', [String(id)]);
    persistDb();
    return { ok: true };
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
app.whenReady().then(async () => {
  await initializeDatabase();
  readNetworkConfig();
  registerIpc();
  registerAccountingIpc();
  registerNetworkIpc();
  if (networkConfig.role === 'server') { try { await startLanServer(networkConfig.port); } catch (error) { networkConfig.role = 'standalone'; saveNetworkConfig(); } }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox('No se pudo iniciar SIFER 360', error && error.message ? error.message : String(error));
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearTimeout(saveTimer); if (networkServer) networkServer.close(); stopDiscoveryServer(); persistDb(); });
