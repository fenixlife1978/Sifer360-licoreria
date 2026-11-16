const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage, shell } = require('electron');
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
const { hasValidBearerToken } = require('./lan-auth.cjs');
const { allocateCashboxSequence: allocateCashboxSequenceDurable } = require('./cashbox-sequence.cjs');
const { getCashboxSequenceMinimum } = require('./cashbox-sequence-minimum.cjs');
const { migrateCashboxSequenceCategories } = require('./cashbox-sequence-migration.cjs');
const { createPasswordHash, verifyPassword, normalizeLegacyUser, publicUser } = require('./auth-credentials.cjs');
const FiscalPrinterManager = require('./fiscal-printer-manager.cjs');
const PrinterManager = require('./printer-manager.cjs');
const { createFiscalNetworkQueue } = require('./fiscal-network-queue.cjs');
let fiscalNetworkQueue = null;
let fiscalNetworkQueueRecovered = false;
const authSessions = new Map();
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
    CREATE TABLE IF NOT EXISTS app_users (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','cajero','contador')),
      cashbox TEXT NOT NULL DEFAULT '—',
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, active);
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
    CREATE TABLE IF NOT EXISTS fiscal_network_jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      source_device_id TEXT NOT NULL,
      source_cashbox TEXT NOT NULL,
      source_cashier TEXT NOT NULL,
      source_station TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      invoice_json TEXT NOT NULL,
      invoice_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','processing','issued','rejected','uncertain')),
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      result_json TEXT,
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_fiscal_network_jobs_status_created
      ON fiscal_network_jobs(status, created_at);
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
function createFiscalNetworkQueueStore() {
  return {
    getByKey: key => one('SELECT * FROM fiscal_network_jobs WHERE idempotency_key=?', [String(key)]),
    getById: id => one('SELECT * FROM fiscal_network_jobs WHERE id=?', [String(id)]),
    insertPending(job) {
      const id = crypto.randomUUID();
      persistMutation(() => run(
        'INSERT INTO fiscal_network_jobs(id,idempotency_key,source_device_id,source_cashbox,source_cashier,source_station,sale_id,invoice_json,invoice_hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [id,job.idempotencyKey,job.sourceDeviceId,job.cashbox,job.cashier,job.station,job.saleId,job.invoiceJson,job.invoiceHash,'pending',job.createdAt]
      ));
      return one('SELECT * FROM fiscal_network_jobs WHERE id=?', [id]);
    },
    nextPending: () => one("SELECT * FROM fiscal_network_jobs WHERE status='pending' ORDER BY created_at,id LIMIT 1"),
    markProcessing(id, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='processing',started_at=?,error='' WHERE id=? AND status='pending'", [at,id]));
    },
    markIssued(id, result, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='issued',result_json=?,finished_at=?,error='' WHERE id=? AND status='processing'", [JSON.stringify(result),at,id]));
    },
    markUncertain(id, error, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='uncertain',error=?,finished_at=? WHERE id=? AND status='processing'", [String(error).slice(0,1000),at,id]));
    },
    markRejected(id, error, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='rejected',error=?,finished_at=? WHERE id=? AND status='processing'", [String(error).slice(0,1000),at,id]));
    },
    markReconciledIssued(id, result, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='issued',result_json=?,finished_at=?,error='Conciliación manual: emisión verificada físicamente.' WHERE id=? AND status='uncertain'", [JSON.stringify(result),at,id]));
    },
    markReconciledNotIssued(id, note, at) {
      persistMutation(() => run("UPDATE fiscal_network_jobs SET status='rejected',error=?,finished_at=? WHERE id=? AND status='uncertain'", ['Conciliación manual: '+String(note).slice(0,800),at,id]));
    },
    hasUncertain: () => !!one("SELECT id FROM fiscal_network_jobs WHERE status='uncertain' LIMIT 1"),
    recoverProcessing(at) {
      const rows=all("SELECT id FROM fiscal_network_jobs WHERE status='processing'");
      if(rows.length) persistMutation(() => run("UPDATE fiscal_network_jobs SET status='uncertain',error='El servidor se reinició durante el envío; requiere conciliación manual.',finished_at=? WHERE status='processing'", [at]));
      return rows;
    },
    list(limit) { return all('SELECT id,idempotency_key,source_device_id,source_cashbox,source_cashier,source_station,sale_id,status,created_at,started_at,finished_at,result_json,error FROM fiscal_network_jobs ORDER BY created_at DESC LIMIT ?', [limit]); }
  };
}
function ensureFiscalNetworkQueue() {
  if (fiscalNetworkQueue) return fiscalNetworkQueue;
  fiscalNetworkQueueRecovered = false;
  fiscalNetworkQueue = createFiscalNetworkQueue({
    store: createFiscalNetworkQueueStore(),
    resolveProfile: async cashbox => {
      const row=one('SELECT payload FROM app_state WHERE id=1');
      const state=row?JSON.parse(row.payload||'{}'):{};
      const profile=state&&state.cfg&&state.cfg.fiscalPrinters&&state.cfg.fiscalPrinters[String(cashbox)];
      return profile?{...profile}:null;
    },
    emitInvoice: (profile,invoice) => FiscalPrinterManager.emitInvoice(profile,invoice)
  });
  return fiscalNetworkQueue;
}
function publicFiscalNetworkJob(job) {
  if(!job)return null;
  let result=null;
  try{result=job.result_json?JSON.parse(job.result_json):null;}catch{}
  return {id:job.id,idempotencyKey:job.idempotency_key,status:job.status,cashbox:job.source_cashbox,cashier:job.source_cashier,station:job.source_station,sourceDeviceId:job.source_device_id,saleId:job.sale_id,createdAt:job.created_at,startedAt:job.started_at,finishedAt:job.finished_at,result,error:job.error||''};
}
async function startLanServer(requestedPort) {
  if (fiscalNetworkQueue && fiscalNetworkQueue.isBusy()) throw new Error('No se puede reiniciar el servidor LAN mientras se transmite una factura fiscal. Espere a que termine el comando o consulte el estado de la impresora.');
  if (networkConfig.role === 'client' || networkConfig.serverPromotionBlocked) throw new Error('Este equipo ya fue cliente LAN y su SQLite local no se considera autoridad. No puede convertirse en servidor automáticamente; restaure o migre la base central mediante un procedimiento explícito antes de promoverlo.');
  if (!db) await initializeDatabase();
  const fiscalQueue = ensureFiscalNetworkQueue();
  const fiscalRecovery = await fiscalQueue.recover();
  fiscalNetworkQueueRecovered = true;
  if (!fiscalRecovery.blocked) fiscalQueue.pump().catch(() => {});
  const port = normalizeLanPort(requestedPort || networkConfig.port || 38760);
  if (networkServer) {
    const previousServer = networkServer;
    await new Promise(resolve => previousServer.close(() => resolve()));
    networkServer = null;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado seguro del sistema operativo no está disponible; no se iniciará el servidor LAN.');
  const identity = await ensureServerCertificate({ directory: app.getPath('userData'), deviceId: networkConfig.deviceId, encryptPrivateKey: pem => safeStorage.encryptString(pem).toString('base64'), decryptPrivateKey: value => safeStorage.decryptString(Buffer.from(value, 'base64')) });
  const previousConfig = { ...networkConfig };
  networkConfig = { ...networkConfig, role: 'server', host: '', port, token: networkConfig.token || crypto.randomBytes(24).toString('hex'), tlsFingerprint: identity.fingerprint, serverCert: '' };
  try {
    saveNetworkConfig();
    networkServer = https.createServer({ key: identity.key, cert: identity.cert }, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!isLanAddress(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'Acceso permitido únicamente desde la red local.' });
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
    if (!hasValidBearerToken(req.headers.authorization, networkConfig.token)) return sendJson(res, 401, { error: 'No autorizado' });
    if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, deviceId: networkConfig.deviceId, role: 'server', protocol: 1 });
    if (url.pathname === '/api/fiscal/queue' && req.method === 'POST') {
      try {
        const body=await readBody(req);
        const cashbox=String(body.cashbox||'').trim();
        const cashier=String(body.cashier||'').trim();
        const station=String(body.station||'').trim();
        const sourceDeviceId=String(body.sourceDeviceId||'').trim();
        if(!cashbox||!cashier||!station||!sourceDeviceId||!body.saleId||!body.idempotencyKey||!body.invoice) return sendJson(res,400,{error:'Faltan datos de origen o factura para la cola fiscal.'});
        if(!/^[A-Za-z0-9._:-]{8,180}$/.test(String(body.idempotencyKey))||! /^[A-Za-z0-9._:-]{8,80}$/.test(sourceDeviceId)) return sendJson(res,400,{error:'Identificador de trabajo o dispositivo inválido.'});
        if(body.invoice.idempotencyKey!==body.idempotencyKey) return sendJson(res,400,{error:'La clave idempotente de la factura no coincide.'});
        const invoice={...body.invoice,origin:{...(body.invoice.origin||{}),cashbox,cashier,terminal:station,deviceId:sourceDeviceId}};
        const queue=ensureFiscalNetworkQueue();
        const accepted=queue.enqueue({idempotencyKey:body.idempotencyKey,cashbox,cashier,station,sourceDeviceId,saleId:body.saleId,invoice});
        return sendJson(res,202,{ok:true,duplicate:accepted.duplicate,job:publicFiscalNetworkJob(accepted.job)});
      } catch(error) { return sendJson(res,400,{error:error.message||'No se pudo registrar el trabajo fiscal.'}); }
    }
    if (url.pathname.startsWith('/api/fiscal/queue/') && req.method === 'POST' && url.pathname.endsWith('/reconcile')) {
      try {
        const key=decodeURIComponent(url.pathname.slice('/api/fiscal/queue/'.length,-'/reconcile'.length));
        const body=await readBody(req);
        const username=String(body.adminUsername||'').trim();
        const admin=one("SELECT username,role,password_hash FROM app_users WHERE username=? COLLATE NOCASE AND active=1",[username]);
        if(!admin||admin.role!=='admin'||!(await verifyPassword(String(body.password||''),admin.password_hash))) return sendJson(res,403,{error:'Credenciales de administrador incorrectas.'});
        const job=await ensureFiscalNetworkQueue().reconcile(key,body.decision,body.details||{});
        return sendJson(res,200,{ok:true,job:publicFiscalNetworkJob(job)});
      } catch(error) { return sendJson(res,400,{error:error.message||'No se pudo conciliar el trabajo fiscal.'}); }
    }
    if (url.pathname === '/api/fiscal/queue' && req.method === 'GET') {
      const jobs=ensureFiscalNetworkQueue().list(200).map(publicFiscalNetworkJob);
      return sendJson(res,200,{ok:true,jobs});
    }
    if (url.pathname.startsWith('/api/fiscal/queue/') && req.method === 'GET') {
      const key=decodeURIComponent(url.pathname.slice('/api/fiscal/queue/'.length));
      const job=ensureFiscalNetworkQueue().get(key);
      return sendJson(res,job?200:404,job?{ok:true,job:publicFiscalNetworkJob(job)}:{error:'Trabajo fiscal no encontrado.'});
    }
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
        const result = allocateCashboxSequence(body.cashbox, body.operation);
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
  } catch (error) {
    stopDiscoveryServer();
    const failedServer = networkServer;
    networkServer = null;
    if (failedServer) await new Promise(resolve => { try { failedServer.close(() => resolve()); } catch { resolve(); } });
    networkConfig = previousConfig;
    try { saveNetworkConfig(); }
    catch (rollbackError) { throw new Error('No se pudo iniciar el servidor LAN y tampoco restaurar su configuración anterior. No use este equipo como servidor hasta revisar network-mode.json. ' + (rollbackError.message || String(rollbackError))); }
    throw error;
  }
}
function allocateCashboxSequence(cashboxId, operationType) {
  if (!db) throw new Error('La base SQLite central no está disponible para reservar consecutivos.');
  const statement = db.prepare('SELECT payload FROM app_state WHERE id=1');
  let state = {};
  try {
    if (statement.step()) {
      const row = statement.getAsObject();
      state = JSON.parse(String(row.payload || '{}'));
    }
  } finally { statement.free(); }
  const minimumValue = getCashboxSequenceMinimum(state, cashboxId, operationType);
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
        if (response.statusCode < 200 || response.statusCode >= 300 || result.ok === false) {
          const error=new Error((response.statusCode === 409 ? 'Conflicto de concurrencia: ' : '') + (result.error || 'El servidor LAN no confirmó la operación (' + response.statusCode + ').'));
          error.statusCode=response.statusCode;
          return reject(error);
        }
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
  const foreignServerEvents = pending.filter(event => !event.serverDeviceId || event.serverDeviceId !== networkConfig.serverDeviceId);
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
  ipcMain.handle('fiscal-network:submit', async (_e,input={}) => {
    const payload={...input,sourceDeviceId:networkConfig.deviceId,station:String(input.station||os.hostname())};
    if(payload.invoice&&typeof payload.invoice==='object')payload.invoice={...payload.invoice,origin:{...(payload.invoice.origin||{}),cashbox:payload.cashbox,cashier:payload.cashier,terminal:payload.station,deviceId:payload.sourceDeviceId}};
    if(networkConfig.role==='client') return clientApi('/api/fiscal/queue',{method:'POST',body:JSON.stringify(payload),timeoutMs:15000});
    if(networkConfig.role==='server'){
      const queue=ensureFiscalNetworkQueue();
      if(!fiscalNetworkQueueRecovered){const recovery=await queue.recover();fiscalNetworkQueueRecovered=true;if(!recovery.blocked)queue.pump().catch(()=>{});}
      const accepted=queue.enqueue(payload);
      return {ok:true,duplicate:accepted.duplicate,job:publicFiscalNetworkJob(accepted.job)};
    }
    throw new Error('La impresora fiscal compartida requiere que este equipo esté conectado como cliente o servidor LAN activo.');
  });
  ipcMain.handle('fiscal-network:status', async (_e,key) => {
    if(networkConfig.role==='client') {
      try{
        const result=await clientApi('/api/fiscal/queue/'+encodeURIComponent(String(key)),{timeoutMs:10000});
        return result.job;
      }catch(error){if(error.statusCode===404)return {status:'missing'};throw error;}
    }
    const queue=ensureFiscalNetworkQueue();
    if(!fiscalNetworkQueueRecovered){await queue.recover();fiscalNetworkQueueRecovered=true;}
    return publicFiscalNetworkJob(queue.get(String(key)))||{status:'missing'};
  });
  ipcMain.handle('fiscal-network:list', async () => {
    if(networkConfig.role==='client') {
      const result=await clientApi('/api/fiscal/queue',{timeoutMs:10000});
      return result.jobs||[];
    }
    const queue=ensureFiscalNetworkQueue();
    if(!fiscalNetworkQueueRecovered){await queue.recover();fiscalNetworkQueueRecovered=true;}
    return queue.list(200).map(publicFiscalNetworkJob);
  });
  ipcMain.handle('fiscal-network:reconcile', async (_e,input={}) => {
    const username=String(input.adminUsername||'').trim();
    if(networkConfig.role==='client') {
      const key=String(input.idempotencyKey||'');
      const result=await clientApi('/api/fiscal/queue/'+encodeURIComponent(key)+'/reconcile',{method:'POST',body:JSON.stringify({adminUsername:username,password:String(input.password||''),decision:input.decision,details:input.details||{}}),timeoutMs:15000});
      return result.job;
    }
    const admin=one("SELECT username,role,password_hash FROM app_users WHERE username=? COLLATE NOCASE AND active=1",[username]);
    if(!admin||admin.role!=='admin'||!(await verifyPassword(String(input.password||''),admin.password_hash))) throw new Error('Credenciales de administrador incorrectas.');
    if(networkConfig.role!=='server') throw new Error('La conciliación de la cola fiscal debe realizarse en el equipo servidor.');
    const queue=ensureFiscalNetworkQueue();
    if(!fiscalNetworkQueueRecovered){await queue.recover();fiscalNetworkQueueRecovered=true;}
    const job=await queue.reconcile(String(input.idempotencyKey||''),input.decision,input.details||{});
    return publicFiscalNetworkJob(job);
  });
  ipcMain.handle('network:status', () => ({ ...networkConfig, running: !!networkServer, addresses: localAddresses() }));
  ipcMain.handle('network:flush-outbox', async () => {
    if (networkConfig.role !== 'client') return { pending: 0, accepted: [], conflicts: [] };
    if (!networkConfig.host || !networkConfig.token) throw new Error('Cliente LAN desconectado. No se confirma ninguna operación pendiente.');
    assertLanHost(networkConfig.host);
    return flushClientOutbox();
  });
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
    const databaseBefore = db.export();
    let transactionCommitted = false;
    db.run('BEGIN IMMEDIATE');
    try {
      const duplicate = one('SELECT event_id,device_id,event_type,entity_type,entity_id,occurred_at,payload FROM local_operation_outbox WHERE event_id=?', [eventId]);
      if (duplicate) {
        const sameEvent = duplicate.device_id === networkConfig.deviceId &&
          duplicate.event_type === eventType && duplicate.entity_type === entityType &&
          duplicate.entity_id === entityId && duplicate.occurred_at === occurredAt &&
          duplicate.payload === payload;
        if (!sameEvent) throw new Error('El identificador de operación ya fue usado con datos diferentes; no se registró una segunda operación.');
        db.run('COMMIT');
        transactionCommitted = true;
        return one('SELECT * FROM local_operation_outbox WHERE event_id=?', [eventId]);
      }
      run('INSERT OR IGNORE INTO device_sequences(device_id,last_seq) VALUES(?,0)', [networkConfig.deviceId]);
      run('UPDATE device_sequences SET last_seq=last_seq+1 WHERE device_id=?', [networkConfig.deviceId]);
      const seq = Number(one('SELECT last_seq FROM device_sequences WHERE device_id=?', [networkConfig.deviceId]).last_seq);
      run('INSERT INTO local_operation_outbox(event_id,device_id,device_seq,event_type,entity_type,entity_id,occurred_at,payload,status) VALUES(?,?,?,?,?,?,?,?,\'pending\')',
        [eventId, networkConfig.deviceId, seq, eventType, entityType, entityId, occurredAt, payload]);
      db.run('COMMIT');
      transactionCommitted = true;
      try { persistDb(); }
      catch (persistError) {
        restoreDatabaseSnapshot(databaseBefore);
        throw new Error('No se confirmó el registro de auditoría en SQLite; se restauró el estado anterior y no se confirmó la operación. ' + (persistError.message || String(persistError)));
      }
      return one('SELECT * FROM local_operation_outbox WHERE event_id=?', [eventId]);
    } catch (error) {
      if (!transactionCommitted) { try { db.run('ROLLBACK'); } catch {} }
      throw error;
    }
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
      return clientApi('/api/sequences/next', { method: 'POST', body: JSON.stringify({ cashbox: input.cashbox, operation: input.operation }), timeoutMs: 8000 });
    }
    return allocateCashboxSequence(input.cashbox, input.operation);
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
      networkConfig = { ...networkConfig, role: 'client', host: '', token: '', serverCert: '', tlsFingerprint: '', serverStateHash: '', serverPromotionBlocked: true };
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

  function requireAuthSession(token, adminOnly = false) {
    const session = authSessions.get(String(token || ''));
    if (!session || session.expiresAt <= Date.now()) {
      if (session) authSessions.delete(String(token));
      throw new Error('La sesión expiró. Inicie sesión nuevamente.');
    }
    if (adminOnly && session.user.role !== 'admin') throw new Error('Solo el administrador puede gestionar usuarios.');
    return session.user;
  }
  ipcMain.handle('auth:initialize-legacy', async (_event, legacyUsers) => {
    if (networkConfig.role === 'client') throw new Error('La gestión de usuarios debe realizarse en el servidor LAN.');
    if (!Array.isArray(legacyUsers) || legacyUsers.length < 1 || legacyUsers.length > 500) throw new Error('No se recibió una lista válida de usuarios para la sincronización inicial.');
    const normalized = legacyUsers.map(normalizeLegacyUser);
    const seen = new Set();
    for (const user of normalized) {
      const key = user.username.toLowerCase();
      if (seen.has(key)) throw new Error('Hay nombres de usuario duplicados en los datos heredados: ' + user.username);
      seen.add(key);
    }
    const prepared = [];
    for (const user of normalized) prepared.push({ ...user, password_hash: await createPasswordHash(user.password) });
    const before = one('SELECT COUNT(*) AS total FROM app_users');
    const placeholders=prepared.map(()=>'?').join(',');
    persistMutation(() => {
      db.run('BEGIN IMMEDIATE');
      try {
        for (const user of prepared) run(
          'INSERT INTO app_users(username,name,role,cashbox,password_hash,active) VALUES(?,?,?,?,?,1) ON CONFLICT(username) DO UPDATE SET name=excluded.name,role=excluded.role,cashbox=excluded.cashbox,password_hash=excluded.password_hash,active=1,updated_at=CURRENT_TIMESTAMP',
          [user.username,user.name,user.role,user.cashbox,user.password_hash]
        );
        run('UPDATE app_users SET active=0,updated_at=CURRENT_TIMESTAMP WHERE username NOT IN ('+placeholders+')', prepared.map(user=>user.username));
        run("INSERT OR REPLACE INTO schema_migrations(migration_key) VALUES('auth-users-scrypt-v1')");
        db.run('COMMIT');
      } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    });
    const migrated = all('SELECT username,name,role,cashbox FROM app_users WHERE active=1 ORDER BY username');
    if (migrated.length !== prepared.length) throw new Error('La sincronización de usuarios en SQLite no coincide; conserve los datos heredados.');
    return { migrated: Number(before&&before.total)===0, synchronized:true, count:migrated.length, users:migrated };
  });
  ipcMain.handle('auth:login', async (_event, credentials = {}) => {
    const username = String(credentials.username || '').trim();
    const password = typeof credentials.password === 'string' ? credentials.password : '';
    if (!username || !password || username.length > 64 || password.length > 1024) throw new Error('Usuario o contraseña incorrectos.');
    const user = one('SELECT username,name,role,cashbox,password_hash FROM app_users WHERE username=? COLLATE NOCASE AND active=1', [username]);
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new Error('Usuario o contraseña incorrectos.');
    const token = crypto.randomBytes(32).toString('hex');
    const safeUser = publicUser(user);
    authSessions.set(token, { user: safeUser, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return { token, user: safeUser, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  });
  ipcMain.handle('auth:verify-session', (_event, token) => {
    try { return { user: requireAuthSession(token), valid: true }; }
    catch { return { user: null, valid: false }; }
  });
  ipcMain.handle('auth:logout', (_event, token) => { authSessions.delete(String(token || '')); return { ok: true }; });
  ipcMain.handle('auth:list-users', (_event, token) => {
    requireAuthSession(token, true);
    return all('SELECT username,name,role,cashbox FROM app_users WHERE active=1 ORDER BY username');
  });
  ipcMain.handle('auth:save-user', async (_event, token, input = {}) => {
    requireAuthSession(token, true);
    const username = String(input.username || '').trim();
    const name = String(input.name || '').trim();
    const role = String(input.role || '').trim().toLowerCase();
    const cashbox = String(input.cashbox || '—').trim();
    const password = typeof input.password === 'string' ? input.password : '';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) || !name || name.length > 120 || !['admin','cajero','contador'].includes(role) || cashbox.length > 40) throw new Error('Datos de usuario inválidos.');
    if (role === 'cajero' && ['—','Todas','SIN-ASIGNAR'].includes(cashbox)) throw new Error('Todo cajero debe tener una caja asignada.');
    const existing = one('SELECT username,password_hash FROM app_users WHERE username=? COLLATE NOCASE', [username]);
    if (!existing && !password) throw new Error('La contraseña es obligatoria para crear un usuario.');
    if (password.length > 1024) throw new Error('La contraseña supera el límite permitido.');
    const passwordHash = password ? await createPasswordHash(password) : existing.password_hash;
    persistMutation(() => run(
      'INSERT INTO app_users(username,name,role,cashbox,password_hash,active) VALUES(?,?,?,?,?,1) ON CONFLICT(username) DO UPDATE SET name=excluded.name,role=excluded.role,cashbox=excluded.cashbox,password_hash=excluded.password_hash,active=1,updated_at=CURRENT_TIMESTAMP',
      [username,name,role,cashbox,passwordHash]
    ));
    for (const [sessionToken, session] of authSessions) {
      if (session.user.username.toLowerCase() === username.toLowerCase()) authSessions.delete(sessionToken);
    }
    return { ok: true, user: { username,name,role,cashbox } };
  });
  ipcMain.handle('auth:delete-user', (_event, token, usernameInput) => {
    const actor = requireAuthSession(token, true);
    const username = String(usernameInput || '').trim();
    if (!username || username.toLowerCase() === actor.username.toLowerCase()) throw new Error('No puede eliminar el usuario de la sesión actual.');
    const target = one('SELECT username,role FROM app_users WHERE username=? COLLATE NOCASE AND active=1', [username]);
    if (!target) return { ok: true, deleted: false };
    if (target.role === 'admin' && Number(one("SELECT COUNT(*) AS total FROM app_users WHERE role='admin' AND active=1").total) <= 1) throw new Error('Debe conservarse al menos un administrador activo.');
    persistMutation(() => run('UPDATE app_users SET active=0,updated_at=CURRENT_TIMESTAMP WHERE username=? COLLATE NOCASE', [username]));
    for (const [sessionToken, session] of authSessions) {
      if (session.user.username.toLowerCase() === username.toLowerCase()) authSessions.delete(sessionToken);
    }
    return { ok: true, deleted: true };
  });
  ipcMain.handle('posdb:get-mode', () => ({ mode: 'sqlite', databasePath: networkConfig.role === 'client' ? null : userDbPath(), source: networkConfig.role === 'client' ? 'lan-server' : 'local' }));
  ipcMain.handle('posdb:set-mode', () => ({ mode: 'sqlite', databasePath: networkConfig.role === 'client' ? null : userDbPath(), source: networkConfig.role === 'client' ? 'lan-server' : 'local' }));
  ipcMain.handle('posdb:load-state', async () => {
    if (networkConfig.role === 'client') {
      if (!networkConfig.host || !networkConfig.token) throw new Error('Este cliente no está conectado al servidor LAN.');
      assertLanHost(networkConfig.host);
      await flushClientOutbox();
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
      await flushClientOutbox();
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
  ipcMain.handle('fiscal-printer:open-download', async (_e, key) => {
    const downloads = {
      pnpSdk32: 'https://desarrollospnp.com/archivos/pnpdll2025a.zip',
      pnpSdk64: 'https://desarrollospnp.com/archivos/pnpdll2022.zip',
      pnpProtocol: 'https://desarrollospnp.com/archivos/PROTOCOLO0141.pdf',
      bematech: 'https://posvenezuela.com/librerias-dll/',
      bematechDownloads: 'https://posvenezuela.com/descargas-2/',
      bematechMP4200: 'https://posvenezuela.com/descargas-mp4200/',
      prolific: 'https://prolificusa.com/product/pl2303gl-8-pin-usb-uart-bridge-controller/',
      ftdi: 'https://ftdichip.com/drivers/',
      silabs: 'https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers',
      hka: 'https://thefactoryhka.com/ve/',
      epson: 'https://epson.com.ve/developers-products',
      quorion: 'https://quorionus.com/downloads/',
      aclas: 'https://www.aclas.com/'
    };
    const url = downloads[String(key || '')];
    if (!url) throw new Error('Descarga no reconocida. Solo se permiten portales oficiales incluidos en SIFER360.');
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('printer:list', async () => PrinterManager.listPrinters());
  ipcMain.handle('printer:print-ticket', async (_e, printerName, text, options = {}) => PrinterManager.printTicket(printerName, text, options));
  ipcMain.handle('printer:test', async (_e, printerName) => PrinterManager.printTicket(printerName, 'SIFER360 LICORERIA\nPRUEBA DE IMPRESION\nTicket no fiscal\n\n', { columns: 42 }));
  ipcMain.handle('fiscal-printer:list-ports', async () => FiscalPrinterManager.listSerialPorts());
  ipcMain.handle('fiscal-printer:select-file', async (_e, kind = 'sdk') => {
    const filters = kind === 'bridge'
      ? [{ name: 'Adaptador fiscal ejecutable', extensions: ['exe'] }]
      : [{ name: 'SDK fiscal', extensions: ['dll', 'ini', 'exe'] }, { name: 'Todos los archivos', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: kind === 'bridge' ? 'Seleccionar puente fiscal autorizado' : 'Seleccionar archivo SDK del fabricante', properties: ['openFile'], filters });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle('fiscal-printer:status', async (_e, profile = {}) => FiscalPrinterManager.getSdkStatus(profile));
  ipcMain.handle('fiscal-printer:test-port', async (_e, profile = {}) => FiscalPrinterManager.testSerialPort(profile));
  ipcMain.handle('fiscal-printer:test-pnp', async (_e, profile = {}) => FiscalPrinterManager.testPnpFiscalStatus(profile));
  ipcMain.handle('fiscal-printer:readiness', async (_e, profile = {}) => FiscalPrinterManager.checkFiscalReadiness(profile));
  ipcMain.handle('fiscal-printer:test-bridge', async (_e, profile = {}) => FiscalPrinterManager.testBridge(profile));
  ipcMain.handle('fiscal-printer:emit-invoice', async (_e, profile = {}, invoice = {}) => FiscalPrinterManager.emitInvoice(profile, invoice));

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
  const rendererLog = path.join(app.getPath('userData'), 'renderer-startup.log');
  const logRenderer = (label, details) => {
    try { fs.appendFileSync(rendererLog, '[' + new Date().toISOString() + '] ' + label + ' ' + JSON.stringify(details || {}) + '\\n', 'utf8'); } catch {}
  };
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) logRenderer('console-error', { level, message, line, sourceId });
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logRenderer('did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (isMainFrame) dialog.showErrorBox('SIFER360: no se pudo cargar la interfaz', errorDescription + '\\nCódigo: ' + errorCode + '\\nRegistro: ' + rendererLog);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logRenderer('render-process-gone', details);
    dialog.showErrorBox('SIFER360: falló el proceso de interfaz', JSON.stringify(details) + '\\nRegistro: ' + rendererLog);
  });
  win.webContents.on('unresponsive', () => logRenderer('renderer-unresponsive'));
  const entry = path.join(__dirname, '../dist/index.html');
  const loading = app.isPackaged || fs.existsSync(entry) ? win.loadFile(entry) : win.loadURL('http://localhost:3000');
  loading.catch(error => {
    logRenderer('load-promise-rejected', { message: error && error.message ? error.message : String(error), entry });
    dialog.showErrorBox('SIFER360: error de carga', (error && error.message ? error.message : String(error)) + '\\nRegistro: ' + rendererLog);
  });
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
    if (networkConfig.role === 'server') { try { await startLanServer(networkConfig.port); } catch (error) { throw new Error('No se pudo reanudar el servidor LAN. SIFER no iniciará en modo local para evitar crear una base de datos paralela. ' + (error && error.message ? error.message : String(error))); } }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('No se pudo iniciar SIFER 360', error && error.message ? error.message : String(error));
    app.quit();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearTimeout(saveTimer); if (networkServer) networkServer.close(); stopDiscoveryServer(); persistDb(); });
