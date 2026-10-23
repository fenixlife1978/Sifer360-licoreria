const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

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
  return path.join(app.getPath('userData'), 'elpiston.sqlite');
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
              const state = stateRow ? JSON.parse(stateRow.payload) : {};
              const records = Array.isArray(state[collection]) ? state[collection] : [];
              const recordId = String(ev.entityId);
              const existingRecord = records.find(item => item && String(item.id ?? item.uuid ?? item.eventId ?? item.no ?? item.number ?? item.ctrlNo ?? item.code ?? '') === recordId);
              if (!existingRecord) {
                state[collection] = [...records, record];
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
        const current = existing ? JSON.parse(existing.payload) : null;
        const merged = mergeStateRecords(current, incoming);
        run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
        const eventId = String(body.deviceId) + '-' + crypto.createHash('sha256').update(JSON.stringify(incoming)).digest('hex');
        run('INSERT OR IGNORE INTO network_sync_events(event_id,device_id,created_at,payload) VALUES(?,?,?,?)', [eventId, String(body.deviceId), new Date().toISOString(), JSON.stringify({ state: incoming })]);
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
function registerIpc() {
  ipcMain.handle('posdb:get-mode', () => ({ mode: 'sqlite', databasePath: userDbPath() }));
  ipcMain.handle('posdb:set-mode', () => ({ mode: 'sqlite', databasePath: userDbPath() }));
  ipcMain.handle('posdb:load-state', () => {
    const row = one('SELECT payload FROM app_state WHERE id=1');
    return { mode: 'sqlite', state: row ? JSON.parse(row.payload) : null };
  });
  ipcMain.handle('posdb:save-state', (_e, state) => {
    if (databaseMode !== 'sqlite') throw new Error('SQLite local no está seleccionado.');
    const payload = JSON.stringify(state);
    run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP', [payload]);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistDb, 80);
    return { ok: true };
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
    title: 'SIFER 360 - Sistema de Punto de Venta e Inventario',
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
