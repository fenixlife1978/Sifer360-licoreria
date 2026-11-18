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
const { applyAccountingMigration } = require('./accounting-migrations.cjs');
const { isLanAddress, assertLanHost } = require('./lan-address.cjs');
const { hasValidBearerToken } = require('./lan-auth.cjs');
const { allocateCashboxSequence: allocateCashboxSequenceDurable } = require('./cashbox-sequence.cjs');
const { getCashboxSequenceMinimum } = require('./cashbox-sequence-minimum.cjs');
const { migrateCashboxSequenceCategories } = require('./cashbox-sequence-migration.cjs');
const { createPasswordHash, verifyPassword, normalizeLegacyUser, publicUser } = require('./auth-credentials.cjs');
const { createAccountingSessionGuard } = require('./accounting-auth.cjs');
const { assertAccountingSettingsChange, assertAccountingPeriodChange, assertAccountingPeriodCanClose, assertAccountingPeriodWritable } = require('./accounting-policy.cjs');
const { buildAccountingSourceEvents } = require('../src/accounting/source-events.cjs');
const FiscalPrinterManager = require('./fiscal-printer-manager.cjs');
const { createLegacyBackupTaskRetirer } = require('./legacy-backup-task.cjs');
const PrinterManager = require('./printer-manager.cjs');
const { createFiscalNetworkQueue } = require('./fiscal-network-queue.cjs');
const { createLicensing } = require('./licensing.cjs');
const { autoUpdater } = require('electron-updater');
const legacyBackupTaskRetirer = createLegacyBackupTaskRetirer();
let fiscalNetworkQueue = null;
let fiscalNetworkQueueRecovered = false;
let licensing = null;
let updateDownloaded = false;
let updateCheckTimer = null;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = console;
function broadcastAppUpdate(status, details = {}) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app-update:status', { status, ...details });
  }
}
autoUpdater.on('checking-for-update', () => broadcastAppUpdate('checking'));
autoUpdater.on('update-available', info => broadcastAppUpdate('available', { version: info.version, releaseNotes: info.releaseNotes || '' }));
autoUpdater.on('update-not-available', info => broadcastAppUpdate('not-available', { version: info.version }));
autoUpdater.on('download-progress', progress => broadcastAppUpdate('download-progress', { percent: Math.round(progress.percent || 0), transferred: progress.transferred, total: progress.total }));
autoUpdater.on('update-downloaded', info => { updateDownloaded = true; broadcastAppUpdate('downloaded', { version: info.version, releaseNotes: info.releaseNotes || '' }); });
autoUpdater.on('error', error => broadcastAppUpdate('error', { message: String(error && error.message || error).slice(0, 500) }));
const authSessions = new Map();
const requireAccountingSession = createAccountingSessionGuard({
  sessions: authSessions,
  findActiveUser: username => one('SELECT username,name,role,cashbox,active FROM app_users WHERE username=? COLLATE NOCASE AND active=1', [username])
});
const ACCOUNTING_READ_CHANNELS = new Set([
  'accounting:get-settings','accounting:get-profile','accounting:list-source-events',
  'accounting:source-event-summary','accounting:list-periods','accounting:list-journal-entries',
  'accounting:list-exchange-rates','accounting:get-trial-balance','accounting:list-accounts',
  'accounting:list-automation-rules','accounting:list-fixed-assets','accounting:list-asset-acquisition-entries','accounting:get-general-ledger','accounting:get-financial-statements'
]);
const accountingIpcHandlers = new Map();
function registerAccountingHandler(channel, handler) {
  accountingIpcHandlers.set(channel, handler);
  ipcMain.handle(channel, async (event, ...args) => {
    if (networkConfig.role === 'client') {
      const filteredRead = ['accounting:get-general-ledger','accounting:get-financial-statements'].includes(channel);
      const payload = filteredRead
        ? (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {})
        : ACCOUNTING_READ_CHANNELS.has(channel)
          ? { token: String(args[0] || '') }
          : (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {});
      const response = await clientApi('/api/accounting/' + encodeURIComponent(channel.slice('accounting:'.length)), {
        method: 'POST', body: JSON.stringify(payload), timeoutMs: 15000
      });
      return response.result;
    }
    return handler(event, ...args);
  });
}
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
let priorUserDataDetected = false;
let clientOutbox = null;
const MAX_SYNC_BODY = 8 * 1024 * 1024;
function readNetworkConfig() {
  const userDataDirectory = app.getPath('userData');
  networkConfigPath = path.join(userDataDirectory, 'network-mode.json');
  const databaseFile = userDbPath();
  // Se detecta el estado previo antes de crear network-mode.json en una instalación nueva.
  // Si una instalación existente perdió tanto la base principal como su .bak, nunca se crea una SQLite vacía.
  priorUserDataDetected = [
    networkConfigPath,
    path.join(userDataDirectory, 'database-mode.json'),
    databaseFile,
    databaseFile + '.bak',
    path.join(userDataDirectory, 'update-backups')
  ].some(candidate => fs.existsSync(candidate));
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
function insertAccountingSourceEvents(events) {
  for (const event of events || []) {
    run(`INSERT OR IGNORE INTO accounting_source_events
      (event_id,source_type,source_id,event_type,occurred_at,payload_hash,payload_json,processing_status)
      VALUES(?,?,?,?,?,?,?,'pending')`,
      [event.eventId,event.sourceType,event.sourceId,event.eventType,event.occurredAt,event.payloadHash,event.payloadJson]);
  }
}
function persistAccountingDb(snapshot) {
  try { persistDb(); }
  catch (error) { restoreDatabaseSnapshot(snapshot); throw error; }
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
  const opened = openOrRecoverDatabase({ SQL, file, allowCreate: !priorUserDataDetected });
  db = opened.database;
  if (opened.recovered) console.warn('SIFER360 recuperó la base SQLite desde el respaldo automático:', opened.source, opened.corruptFile || '');
  initializeSchema();
  const accountingSchemaPath = path.join(__dirname, '..', 'src', 'accounting', 'schema.sql');
  if (!fs.existsSync(accountingSchemaPath)) throw new Error('Falta el esquema contable de la instalación; se conserva la base de datos y se detiene el inicio.');
  const accountingMigration = applyAccountingMigration({ db, schemaSql: fs.readFileSync(accountingSchemaPath, 'utf8'), persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
  if (accountingMigration.applied) console.info('Migración contable aplicada sin eliminar datos existentes:', accountingMigration.migrationKey);
  const automationSchemaPath = path.join(__dirname, '..', 'src', 'accounting', 'automation-schema.sql');
  if (!fs.existsSync(automationSchemaPath)) throw new Error('Falta el esquema de automatización contable; se conserva la base de datos y se detiene el inicio.');
  const automationMigration = applyAccountingMigration({ db, schemaSql: fs.readFileSync(automationSchemaPath, 'utf8'), migrationKey: 'accounting-automation-v1', persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
  if (automationMigration.applied) console.info('Migración de reglas contables aplicada sin eliminar datos existentes:', automationMigration.migrationKey);
  const fixedAssetsSchemaPath = path.join(__dirname, '..', 'src', 'accounting', 'fixed-assets-schema.sql');
  if (!fs.existsSync(fixedAssetsSchemaPath)) throw new Error('Falta el esquema de activos fijos; se conserva la base de datos y se detiene el inicio.');
  const fixedAssetsMigration = applyAccountingMigration({ db, schemaSql: fs.readFileSync(fixedAssetsSchemaPath, 'utf8'), migrationKey: 'accounting-fixed-assets-v1', persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
  if (fixedAssetsMigration.applied) console.info('Migración de activos fijos aplicada sin eliminar datos existentes:', fixedAssetsMigration.migrationKey);
  const reversalTransitionSchemaPath = path.join(__dirname, '..', 'src', 'accounting', 'reversal-transition-schema.sql');
  if (!fs.existsSync(reversalTransitionSchemaPath)) throw new Error('Falta la migración de reversos contables; se conserva la base de datos y se detiene el inicio.');
  const reversalTransitionMigration = applyAccountingMigration({ db, schemaSql: fs.readFileSync(reversalTransitionSchemaPath, 'utf8'), migrationKey: 'accounting-journal-reversal-transition-v1', persist: () => persistDb(), restore: snapshot => restoreDatabaseSnapshot(snapshot) });
  if (reversalTransitionMigration.applied) console.info('Migración de transición de reversos aplicada sin eliminar datos existentes:', reversalTransitionMigration.migrationKey);
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
    if (url.pathname === '/api/auth/session' && req.method === 'POST') {
      const body=await readBody(req),session=authSessions.get(String(body.token||''));
      if(!session||session.expiresAt<=Date.now())return sendJson(res,200,{user:null,valid:false});
      return sendJson(res,200,{user:session.user,valid:true});
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const body=await readBody(req);authSessions.delete(String(body.token||''));return sendJson(res,200,{ok:true});
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const credentials=await readBody(req);
        const username=String(credentials.username||'').trim();
        const password=typeof credentials.password==='string'?credentials.password:'';
        if(!username||!password||username.length>64||password.length>1024)return sendJson(res,400,{error:'Usuario o contraseña incorrectos.'});
        const user=one('SELECT username,name,role,cashbox,password_hash FROM app_users WHERE username=? COLLATE NOCASE AND active=1',[username]);
        if(!user||!(await verifyPassword(password,user.password_hash)))return sendJson(res,401,{error:'Usuario o contraseña incorrectos.'});
        const token=crypto.randomBytes(32).toString('hex');
        const safeUser=publicUser(user);
        const expiresAt=Date.now()+12*60*60*1000;
        authSessions.set(token,{user:safeUser,expiresAt});
        return sendJson(res,200,{token,user:safeUser,expiresAt});
      }catch(error){return sendJson(res,400,{error:error.message||'No se pudo autenticar el usuario.'});}
    }
    if (url.pathname === '/api/fiscal/queue' && req.method === 'POST') {
      try {
        const body=await readBody(req);
        const userSession=authSessions.get(String(body.userSessionToken||''));
        if(!userSession||userSession.expiresAt<=Date.now())return sendJson(res,401,{error:'La sesión del cajero expiró. Inicie sesión nuevamente.'});
        const authenticatedUser=userSession.user;
        if(!['admin','cajero'].includes(authenticatedUser.role))return sendJson(res,403,{error:'El rol de usuario no puede emitir documentos fiscales desde el POS.'});
        const cashbox=String(body.cashbox||'').trim();
        const cashier=String(body.cashier||'').trim();
        const station=String(body.station||'').trim();
        const sourceDeviceId=String(body.sourceDeviceId||'').trim();
        if(!cashbox||!cashier||!station||!sourceDeviceId||!body.saleId||!body.idempotencyKey||!body.invoice) return sendJson(res,400,{error:'Faltan datos de origen o factura para la cola fiscal.'});
        if(String(cashier)!==String(authenticatedUser.name))return sendJson(res,403,{error:'El cajero de origen no coincide con el usuario autenticado.'});
        if(authenticatedUser.role==='cajero'&&String(authenticatedUser.cashbox)!==cashbox)return sendJson(res,403,{error:'El usuario autenticado no está asignado a la caja indicada.'});
        if(!/^[A-Za-z0-9._:-]{8,180}$/.test(String(body.idempotencyKey))||! /^[A-Za-z0-9._:-]{8,80}$/.test(sourceDeviceId)) return sendJson(res,400,{error:'Identificador de trabajo o dispositivo inválido.'});
        if(body.invoice.idempotencyKey!==body.idempotencyKey) return sendJson(res,400,{error:'La clave idempotente de la factura no coincide.'});
        const invoice={...body.invoice,origin:{...(body.invoice.origin||{}),cashbox,cashier,terminal:station,deviceId:sourceDeviceId},footerLines:['CAJA: '+cashbox,'CAJERO: '+cashier,'TERMINAL: '+station].map(x=>String(x).slice(0,40))};
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
        if (!body || !body.state || typeof body.state !== 'object' || Array.isArray(body.state) || !body.deviceId || typeof body.expectedHash !== 'string') return sendJson(res, 400, { error: 'Paquete incompleto o sin versión de origen' });
        const incoming = body.state;
        const existing = one('SELECT payload FROM app_state WHERE id=1');
        const currentHash = statePayloadHash(existing ? existing.payload : '');
        if (body.expectedHash !== currentHash) return sendJson(res, 409, { error: 'La base central cambió desde la última lectura. Recargue los datos del servidor antes de volver a guardar.', conflict: true, stateHash: currentHash });
        const current = existing ? JSON.parse(existing.payload) : {};
        const merged = mergeStateRecords(current, incoming);
        const accountingEvents = buildAccountingSourceEvents(current, merged, { deviceId: String(body.deviceId) });
        const eventId = String(body.deviceId) + '-' + crypto.createHash('sha256').update(JSON.stringify(incoming)).digest('hex');
        persistMutation(() => {
          run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
          insertAccountingSourceEvents(accountingEvents);
          run('INSERT OR IGNORE INTO network_sync_events(event_id,device_id,created_at,payload) VALUES(?,?,?,?)', [eventId, String(body.deviceId), new Date().toISOString(), JSON.stringify({ state: incoming })]);
        });
        const savedRow = one('SELECT payload FROM app_state WHERE id=1');
        return sendJson(res, 200, { ok: true, state: merged, stateHash: statePayloadHash(savedRow && savedRow.payload), serverDeviceId: networkConfig.deviceId, updatedAt: new Date().toISOString() });
      } catch (error) { return sendJson(res, 400, { error: error.message || 'Error sincronizando' }); }
    }
    if (url.pathname.startsWith('/api/accounting/') && req.method === 'POST') {
      try {
        const operation = decodeURIComponent(url.pathname.slice('/api/accounting/'.length));
        const channel = 'accounting:' + operation;
        const handler = accountingIpcHandlers.get(channel);
        if (!handler) return sendJson(res, 404, { error: 'Operación contable no encontrada.' });
        const payload = await readBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { error: 'Solicitud contable inválida.' });
        const senderUrl = app.isPackaged ? 'file:///sifer/dist/index.html' : 'http://localhost:3000';
        const sender = { senderFrame: { url: senderUrl } };
        const result = ACCOUNTING_READ_CHANNELS.has(channel)
          ? await handler(sender, String(payload.token || ''))
          : await handler(sender, payload);
        return sendJson(res, 200, { ok: true, result });
      } catch (error) {
        const message = error && error.message ? error.message : 'No se pudo ejecutar la operación contable.';
        const status = /sesión|autenticad/i.test(message) ? 401 : /rol|autorizad/i.test(message) ? 403 : 400;
        return sendJson(res, status, { error: message });
      }
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
    if(networkConfig.role==='server'){
      const session=authSessions.get(String(input.userSessionToken||''));
      if(!session||session.expiresAt<=Date.now())throw new Error('La sesión del cajero expiró. Inicie sesión nuevamente.');
      if(!['admin','cajero'].includes(session.user.role))throw new Error('El rol de usuario no puede emitir documentos fiscales desde el POS.');
      if(String(input.cashier)!==String(session.user.name))throw new Error('El cajero no coincide con la sesión autenticada.');
      if(session.user.role==='cajero'&&String(input.cashbox)!==String(session.user.cashbox))throw new Error('El usuario no está asignado a la caja indicada.');
      if(payload.invoice&&typeof payload.invoice==='object')payload.invoice={...payload.invoice,origin:{...(payload.invoice.origin||{}),cashbox:String(input.cashbox),cashier:session.user.name,terminal:os.hostname(),deviceId:networkConfig.deviceId},footerLines:['CAJA: '+String(input.cashbox),'CAJERO: '+session.user.name,'TERMINAL: '+os.hostname()].map(x=>String(x).slice(0,40))};
    }
    if(networkConfig.role!=='server'&&payload.invoice&&typeof payload.invoice==='object')payload.invoice={...payload.invoice,origin:{...(payload.invoice.origin||{}),cashbox:payload.cashbox,cashier:payload.cashier,terminal:payload.station,deviceId:payload.sourceDeviceId}};
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
    if (fiscalNetworkQueue && fiscalNetworkQueue.isBusy()) throw new Error('No se puede detener el servidor LAN mientras la impresora fiscal está ejecutando un comando. Espere la confirmación o consulte la máquina.');
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
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Estado POS inválido para sincronización.');
      const row = one('SELECT payload FROM app_state WHERE id=1');
      const previous = row ? JSON.parse(row.payload) : {};
      const merged = mergeStateRecords(previous, state);
      const accountingEvents = buildAccountingSourceEvents(previous, merged, { deviceId: networkConfig.deviceId });
      persistMutation(() => {
        run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP', [JSON.stringify(merged)]);
        insertAccountingSourceEvents(accountingEvents);
      });
      return { ok: true, state: merged, role: 'server', accountingEventsCaptured: accountingEvents.length, updatedAt: new Date().toISOString() };
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
  return requireAccountingSession(String(input && input.token || ''), { allowedRoles: ['admin', 'contador'] });
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
  const lines = all('SELECT account_code AS accountCode,debit_minor AS debitMinor,credit_minor AS creditMinor,presentation_debit_minor AS presentationDebitMinor,presentation_credit_minor AS presentationCreditMinor,description,third_party_id AS thirdPartyId,cost_center AS costCenter FROM journal_lines WHERE entry_id=? ORDER BY line_no', [entryId]).map(line => ({...line,debitMinor:Number(line.debitMinor),creditMinor:Number(line.creditMinor),presentationDebitMinor:line.presentationDebitMinor==null?null:Number(line.presentationDebitMinor),presentationCreditMinor:line.presentationCreditMinor==null?null:Number(line.presentationCreditMinor)}));
  return {
    id:row.id,sourceType:row.source_type,sourceId:row.source_id,entryDate:row.entry_date,periodId:row.period_id,
    currency:row.functional_currency,presentationCurrency:row.presentation_currency||row.functional_currency,
    exchangeRateId:row.exchange_rate_id||null,exchangeRateNumerator:Number(row.exchange_rate_numerator||1),
    exchangeRateDenominator:Number(row.exchange_rate_denominator||1),exchangeRateType:row.exchange_rate_type||null,
    exchangeRateSource:row.exchange_rate_source||null,presentationDebitMinor:row.presentation_debit_minor==null?null:Number(row.presentation_debit_minor),
    presentationCreditMinor:row.presentation_credit_minor==null?null:Number(row.presentation_credit_minor),
    ruleVersion:row.rule_version,description:row.description,status:row.status,
    debitMinor:Number(row.debit_minor),creditMinor:Number(row.credit_minor),createdAt:row.created_at,createdBy:row.created_by,
    approvedAt:row.approved_at,approvedBy:row.approved_by,postedAt:row.posted_at,postedBy:row.posted_by,
    reversesEntryId:row.reverses_entry_id,lines
  };
}
function insertJournalEntry(entry) {
  run(`INSERT INTO journal_entries(id,source_type,source_id,entry_date,period_id,functional_currency,presentation_currency,exchange_rate_id,exchange_rate_numerator,exchange_rate_denominator,exchange_rate_type,exchange_rate_source,presentation_debit_minor,presentation_credit_minor,rule_version,description,status,debit_minor,credit_minor,created_at,created_by,approved_at,approved_by,posted_at,posted_by,reverses_entry_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entry.id,entry.sourceType,entry.sourceId,entry.entryDate,entry.periodId,entry.currency,entry.presentationCurrency||entry.currency,
      entry.exchangeRateId||null,entry.exchangeRateNumerator||1,entry.exchangeRateDenominator||1,entry.exchangeRateType||null,entry.exchangeRateSource||null,
      entry.presentationDebitMinor??entry.debitMinor,entry.presentationCreditMinor??entry.creditMinor,
      entry.ruleVersion,entry.description,entry.status,entry.debitMinor,entry.creditMinor,entry.createdAt,entry.createdBy,entry.approvedAt,entry.approvedBy,entry.postedAt,entry.postedBy,entry.reversesEntryId]);
  entry.lines.forEach((line,index)=>run('INSERT INTO journal_lines(id,entry_id,line_no,account_code,debit_minor,credit_minor,presentation_debit_minor,presentation_credit_minor,description,third_party_id,cost_center) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),entry.id,index+1,line.accountCode,line.debitMinor,line.creditMinor,line.presentationDebitMinor??line.debitMinor,line.presentationCreditMinor??line.creditMinor,line.description||'',line.thirdPartyId||null,line.costCenter||null]));
}

function formatAccountingRate(numerator, denominator) {
  const n=BigInt(numerator), d=BigInt(denominator);
  if(n<=0n||d<=0n)return '—';
  const scale=100000000n;
  const scaled=(n*scale+d/2n)/d;
  const whole=scaled/scale;
  const fraction=String(scaled%scale).padStart(8,'0').replace(/0+$/,'');
  return fraction?String(whole)+'.'+fraction:String(whole);
}
function registerAccountingIpc() {
  registerAccountingHandler('accounting:get-settings', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return one('SELECT accounting_framework AS accountingFramework,functional_currency AS functionalCurrency,presentation_currency AS presentationCurrency,monetary_decimals AS monetaryDecimals,automation_mode AS automationMode,policy_version AS policyVersion,updated_at AS updatedAt,updated_by AS updatedBy FROM accounting_settings WHERE id=1');
  });
  registerAccountingHandler('accounting:save-settings', (event, input = {}) => {
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
    const journalEntryCount = Number(one('SELECT COUNT(*) AS total FROM journal_entries').total || 0);
    assertAccountingSettingsChange(before, {
      accountingFramework: framework, functionalCurrency, presentationCurrency, monetaryDecimals: decimals
    }, journalEntryCount);
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const lockedBefore = one('SELECT * FROM accounting_settings WHERE id=1');
      const lockedEntryCount = Number(one('SELECT COUNT(*) AS total FROM journal_entries').total || 0);
      assertAccountingSettingsChange(lockedBefore, { accountingFramework: framework, functionalCurrency, presentationCurrency, monetaryDecimals: decimals }, lockedEntryCount);
      run(`INSERT INTO accounting_settings(id,accounting_framework,functional_currency,presentation_currency,monetary_decimals,automation_mode,policy_version,updated_at,updated_by)
        VALUES(1,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET accounting_framework=excluded.accounting_framework,functional_currency=excluded.functional_currency,presentation_currency=excluded.presentation_currency,monetary_decimals=excluded.monetary_decimals,automation_mode=excluded.automation_mode,policy_version=excluded.policy_version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
        [framework, functionalCurrency, presentationCurrency, decimals, automation, policyVersion, now, actor.actorId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(), 'accounting_settings', '1', 'update', actor.actorId, now, lockedBefore ? JSON.stringify(lockedBefore) : null, JSON.stringify({ accountingFramework: framework, functionalCurrency, presentationCurrency, monetaryDecimals: decimals, automationMode: automation, policyVersion })]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistAccountingDb(dbSnapshot);
    return one('SELECT accounting_framework AS accountingFramework,functional_currency AS functionalCurrency,presentation_currency AS presentationCurrency,monetary_decimals AS monetaryDecimals,automation_mode AS automationMode,policy_version AS policyVersion,updated_at AS updatedAt,updated_by AS updatedBy FROM accounting_settings WHERE id=1');
  });
  registerAccountingHandler('accounting:get-profile', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return one('SELECT * FROM fiscal_entity_profile WHERE id=1');
  });
  registerAccountingHandler('accounting:save-profile', (event, input = {}) => {
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
    const dbSnapshot = db.export();
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
    persistAccountingDb(dbSnapshot);
    return one('SELECT * FROM fiscal_entity_profile WHERE id=1');
  });
  registerAccountingHandler('accounting:list-source-events', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT event_id AS eventId,source_type AS sourceType,source_id AS sourceId,event_type AS eventType,
      occurred_at AS occurredAt,processing_status AS processingStatus,error_message AS errorMessage,payload_json AS payloadJson
      FROM accounting_source_events ORDER BY occurred_at DESC LIMIT 100`).map(row => {
        let payload = null; try { payload = JSON.parse(row.payloadJson); } catch {}
        delete row.payloadJson;
        return { ...row, payload };
      });
  });
  registerAccountingHandler('accounting:mark-source-event-review', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const eventId = String(input.eventId || '').trim();
    const reason = String(input.reason || '').trim().slice(0, 1000);
    if (!eventId || !reason) throw new Error('Selecciona el evento e indica el motivo de revisión.');
    const before = one('SELECT event_id,source_type,source_id,event_type,processing_status FROM accounting_source_events WHERE event_id=?', [eventId]);
    if (!before) throw new Error('El evento contable no existe.');
    if (!['pending','needs_review'].includes(before.processing_status)) throw new Error('Solo se pueden marcar eventos pendientes o ya en revisión.');
    const now = new Date().toISOString();
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE accounting_source_events SET processing_status='needs_review',error_message=? WHERE event_id=?", [reason,eventId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_source_event',eventId,'mark_needs_review',actor.actorId,now,reason,JSON.stringify(before),JSON.stringify({processingStatus:'needs_review',reason})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistAccountingDb(dbSnapshot);
    return one('SELECT event_id AS eventId,processing_status AS processingStatus,error_message AS errorMessage FROM accounting_source_events WHERE event_id=?',[eventId]);
  });
  registerAccountingHandler('accounting:source-event-summary', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    const rows = all('SELECT processing_status AS status,COUNT(*) AS total FROM accounting_source_events GROUP BY processing_status');
    const summary = { pending: 0, processed: 0, rejected: 0, needs_review: 0, total: 0 };
    for (const row of rows) { summary[row.status] = Number(row.total); summary.total += Number(row.total); }
    return summary;
  });
  registerAccountingHandler('accounting:list-periods', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all('SELECT id,label,start_date AS startDate,end_date AS endDate,status,closed_at AS closedAt,closed_by AS closedBy FROM accounting_periods ORDER BY start_date');
  });
  registerAccountingHandler('accounting:save-period', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const id = String(input.id || '').trim();
    const label = String(input.label || '').trim();
    const startDate = String(input.startDate || '');
    const endDate = String(input.endDate || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(id) || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate || !label || startDate.slice(0,7)!==id || endDate.slice(0,7)!==id) throw new Error('Período inválido: el identificador AAAA-MM debe coincidir con las fechas de inicio y fin.');
    const overlap = one('SELECT id FROM accounting_periods WHERE id<>? AND start_date<=? AND end_date>=? LIMIT 1', [id,endDate,startDate]);
    if (overlap) throw new Error('El período se solapa con el período contable ' + overlap.id + '.');
    const existing = one('SELECT status,start_date AS startDate,end_date AS endDate FROM accounting_periods WHERE id=?', [id]);
    const periodEntryCount = Number(one('SELECT COUNT(*) AS total FROM journal_entries WHERE period_id=?', [id]).total || 0);
    assertAccountingPeriodChange(existing, { startDate, endDate }, periodEntryCount);
    const now = new Date().toISOString();
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const lockedOverlap = one('SELECT id FROM accounting_periods WHERE id<>? AND start_date<=? AND end_date>=? LIMIT 1', [id,endDate,startDate]);
      if (lockedOverlap) throw new Error('El período se solapa con el período contable ' + lockedOverlap.id + '.');
      const lockedExisting = one('SELECT status,start_date AS startDate,end_date AS endDate FROM accounting_periods WHERE id=?', [id]);
      const lockedEntryCount = Number(one('SELECT COUNT(*) AS total FROM journal_entries WHERE period_id=?', [id]).total || 0);
      assertAccountingPeriodChange(lockedExisting, { startDate, endDate }, lockedEntryCount);
      run('INSERT INTO accounting_periods(id,label,start_date,end_date,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,start_date=excluded.start_date,end_date=excluded.end_date', [id,label,startDate,endDate,'open']);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_period',id,lockedExisting?'update':'create',actor.actorId,now,lockedExisting?JSON.stringify(lockedExisting):null,JSON.stringify({label,startDate,endDate})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistAccountingDb(dbSnapshot);
    return one('SELECT id,label,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [id]);
  });

  registerAccountingHandler('accounting:close-period', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    if (actor.actorRole !== 'contador') throw new Error('El cierre de períodos está reservado al perfil Contador.');
    const periodId = String(input.periodId || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new Error('Identificador de período inválido.');
    const snapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const period = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [periodId]);
      const drafts = Number(one("SELECT COUNT(*) AS total FROM journal_entries WHERE period_id=? AND status IN ('draft','approved')", [periodId]).total || 0);
      const unresolved = Number(one("SELECT COUNT(*) AS total FROM accounting_source_events WHERE substr(occurred_at,1,10)>=? AND substr(occurred_at,1,10)<=? AND processing_status IN ('pending','needs_review')", [period?.startDate || '9999-12-31',period?.endDate || '0000-01-01']).total || 0);
      const invalidEntries = all(`SELECT j.id,j.debit_minor AS debitMinor,j.credit_minor AS creditMinor,
        COUNT(l.id) AS lineCount,COALESCE(SUM(l.debit_minor),0) AS lineDebit,COALESCE(SUM(l.credit_minor),0) AS lineCredit
        FROM journal_entries j LEFT JOIN journal_lines l ON l.entry_id=j.id
        WHERE j.period_id=? AND j.status IN ('posted','reversed') GROUP BY j.id`, [periodId]).filter(row =>
          Number(row.lineCount) < 2 || Number(row.lineDebit) !== Number(row.debitMinor) ||
          Number(row.lineCredit) !== Number(row.creditMinor) || Number(row.debitMinor) !== Number(row.creditMinor)
        ).length;
      const settings = one('SELECT functional_currency AS functionalCurrency,presentation_currency AS presentationCurrency FROM accounting_settings WHERE id=1');
      const missingPresentation = settings && settings.functionalCurrency !== settings.presentationCurrency
        ? Number(one("SELECT COUNT(*) AS total FROM journal_entries WHERE period_id=? AND status IN ('posted','reversed') AND (presentation_debit_minor IS NULL OR presentation_credit_minor IS NULL)", [periodId]).total || 0)
        : 0;
      const pendingAssetDepreciations = period ? Number(one(`
        SELECT COUNT(*) AS total FROM accounting_fixed_assets a
        LEFT JOIN accounting_asset_depreciations d ON d.asset_id=a.id AND d.depreciation_month=?
        WHERE a.status='active' AND a.depreciation_start_month<=? AND a.available_for_use_date<=?
          AND ((CAST(substr(?,1,4) AS INTEGER)-CAST(substr(a.depreciation_start_month,1,4) AS INTEGER))*12
             + CAST(substr(?,6,2) AS INTEGER)-CAST(substr(a.depreciation_start_month,6,2) AS INTEGER)) < a.useful_life_months
          AND (d.id IS NULL OR d.status='reversed'
            OR (SELECT COUNT(*) FROM accounting_asset_depreciations prior
                WHERE prior.asset_id=a.id AND prior.depreciation_month<? AND prior.status='posted') <
               ((CAST(substr(?,1,4) AS INTEGER)-CAST(substr(a.depreciation_start_month,1,4) AS INTEGER))*12
                + CAST(substr(?,6,2) AS INTEGER)-CAST(substr(a.depreciation_start_month,6,2) AS INTEGER))
      `, [periodId,periodId,period.endDate,periodId,periodId,periodId,periodId,periodId]).total || 0) : 0;
      assertAccountingPeriodCanClose({ period, draftCount:drafts, unresolvedEventCount:unresolved, invalidEntryCount:invalidEntries, missingPresentationCount:missingPresentation, pendingAssetDepreciationCount:pendingAssetDepreciations });
      const now = new Date().toISOString();
      run("UPDATE accounting_periods SET status='closed',closed_at=?,closed_by=? WHERE id=? AND status='open'", [now,actor.actorId,periodId]);
      if (db.getRowsModified() !== 1) throw new Error('El período cambió de estado antes de confirmar el cierre.');
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_period',periodId,'close',actor.actorId,now,JSON.stringify({status:'open'}),JSON.stringify({status:'closed',draftCount:drafts,unresolvedEventCount:unresolved,invalidEntryCount:invalidEntries,missingPresentationCount:missingPresentation,pendingAssetDepreciationCount})]);
      db.run('COMMIT');
      persistAccountingDb(snapshot);
      return one('SELECT id,label,start_date AS startDate,end_date AS endDate,status,closed_at AS closedAt,closed_by AS closedBy FROM accounting_periods WHERE id=?', [periodId]);
    } catch (error) {
      try { db.run('ROLLBACK'); } catch {}
      throw error;
    }
  });

  registerAccountingHandler('accounting:list-journal-entries', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT id,source_type AS sourceType,source_id AS sourceId,entry_date AS entryDate,period_id AS periodId,
      functional_currency AS currency,presentation_currency AS presentationCurrency,
      exchange_rate_numerator AS exchangeRateNumerator,exchange_rate_denominator AS exchangeRateDenominator,
      presentation_debit_minor AS presentationDebitMinor,presentation_credit_minor AS presentationCreditMinor,
      description,status,debit_minor AS debitMinor,credit_minor AS creditMinor,
      created_by AS createdBy,approved_by AS approvedBy,posted_by AS postedBy,reverses_entry_id AS reversesEntryId
      FROM journal_entries ORDER BY entry_date DESC,created_at DESC LIMIT 100`);
  });
  registerAccountingHandler('accounting:list-exchange-rates', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT id,rate_date AS rateDate,from_currency AS fromCurrency,to_currency AS toCurrency,
      rate_numerator AS rateNumerator,rate_denominator AS rateDenominator,rate_type AS rateType,
      source_name AS sourceName,source_reference AS sourceReference,recorded_at AS recordedAt,recorded_by AS recordedBy
      FROM accounting_exchange_rates ORDER BY rate_date DESC,recorded_at DESC LIMIT 100`).map(row=>({
        ...row,rate:formatAccountingRate(row.rateNumerator,row.rateDenominator)
      }));
  });
  registerAccountingHandler('accounting:get-trial-balance', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT a.code,a.name,a.account_type AS accountType,a.normal_balance AS normalBalance,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.debit_minor ELSE 0 END),0) AS debitMinor,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.credit_minor ELSE 0 END),0) AS creditMinor,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.presentation_debit_minor ELSE 0 END),0) AS presentationDebitMinor,
      COALESCE(SUM(CASE WHEN j.status IN ('posted','reversed') THEN l.presentation_credit_minor ELSE 0 END),0) AS presentationCreditMinor,
      (SELECT COUNT(*) FROM journal_entries legacy WHERE legacy.status IN ('posted','reversed') AND legacy.presentation_debit_minor IS NULL) AS unconvertedEntryCount
      FROM chart_of_accounts a LEFT JOIN journal_lines l ON l.account_code=a.code
      LEFT JOIN journal_entries j ON j.id=l.entry_id
      GROUP BY a.code,a.name,a.account_type,a.normal_balance ORDER BY a.code`);
  });
  registerAccountingHandler('accounting:create-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const settings = one('SELECT accounting_framework,functional_currency,presentation_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
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
    const { buildBimonetaryLines, decimalRateToRational } = await import('../src/accounting/bimonetary.mjs');
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
    const presentationCurrency=String(settings.presentation_currency||'').trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(presentationCurrency))throw new Error('Configura la moneda de presentación antes de crear asientos.');
    let rate={rateNumerator:1,rateDenominator:1},rateType=null,rateSource=null,rateId=null,rateRecordExists=false;
    if(settings.functional_currency!==presentationCurrency){
      rate=decimalRateToRational(input.exchangeRate);
      rateType=String(input.exchangeRateType||'');
      const sourceName=String(input.exchangeRateSourceName||'').trim().slice(0,120);
      const sourceReference=String(input.exchangeRateSourceReference||'').trim().slice(0,180);
      if(!['official','market','contractual','accounting_adjustment'].includes(rateType)||!sourceName||!sourceReference)
        throw new Error('La tasa bimonetaria exige tipo, fuente y referencia documental.');
      rateSource=sourceName+' · '+sourceReference;
      const existingRate=one('SELECT id,rate_numerator AS rateNumerator,rate_denominator AS rateDenominator,source_name AS sourceName FROM accounting_exchange_rates WHERE rate_date=? AND from_currency=? AND to_currency=? AND rate_type=? AND source_reference=?',
        [entryDate,settings.functional_currency,presentationCurrency,rateType,sourceReference]);
      if(existingRate){
        if(Number(existingRate.rateNumerator)!==rate.rateNumerator||Number(existingRate.rateDenominator)!==rate.rateDenominator||String(existingRate.sourceName)!==sourceName)
          throw new Error('Ya existe una tasa con esa fecha, par, tipo y referencia documental, pero con otro valor. Documenta la corrección con una referencia distinta.');
        rateId=existingRate.id;rateRecordExists=true;
      }else rateId=crypto.randomUUID();
    }
    const converted=buildBimonetaryLines({lines,functionalCurrency:settings.functional_currency,presentationCurrency,
      functionalDecimals:Number(settings.monetary_decimals),presentationDecimals:Number(settings.monetary_decimals),
      rateNumerator:rate.rateNumerator,rateDenominator:rate.rateDenominator});
    const id=crypto.randomUUID();
    const entry=createJournalEntry({id,sourceType:'manual',sourceId:id,entryDate,periodId,currency:settings.functional_currency,
      ruleVersion:String(settings.policy_version)+' / MANUAL-v1',description,lines:converted.lines,createdAt:new Date().toISOString(),createdBy:actor.actorId});
    Object.assign(entry,{presentationCurrency,exchangeRateId:rateId,exchangeRateNumerator:rate.rateNumerator,
      exchangeRateDenominator:rate.rateDenominator,exchangeRateType:rateType,exchangeRateSource:rateSource,
      presentationDebitMinor:converted.presentationDebitMinor,presentationCreditMinor:converted.presentationCreditMinor});
    entry.lines=converted.lines;
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const lockedSettings = one('SELECT accounting_framework,functional_currency,presentation_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
      if (!lockedSettings || lockedSettings.accounting_framework !== settings.accounting_framework || lockedSettings.functional_currency !== settings.functional_currency || lockedSettings.presentation_currency !== settings.presentation_currency || Number(lockedSettings.monetary_decimals) !== Number(settings.monetary_decimals) || lockedSettings.policy_version !== settings.policy_version) throw new Error('La configuración contable cambió durante la preparación del asiento. Vuelve a intentarlo.');
      const lockedPeriod = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [periodId]);
      assertAccountingPeriodWritable(lockedPeriod, entryDate);
      for (const line of lines) {
        const account = one('SELECT active,accepts_posting,framework_scope FROM chart_of_accounts WHERE code=?', [line.accountCode]);
        if (!account || Number(account.active)!==1 || Number(account.accepts_posting)!==1 || (account.framework_scope!=='both' && account.framework_scope!==lockedSettings.accounting_framework)) throw new Error('La cuenta '+line.accountCode+' cambió o dejó de estar habilitada durante la preparación del asiento.');
      }
      if(rateId&&!rateRecordExists)run('INSERT INTO accounting_exchange_rates(id,rate_date,from_currency,to_currency,rate_numerator,rate_denominator,rate_type,source_name,source_reference,recorded_at,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [rateId,entryDate,settings.functional_currency,presentationCurrency,rate.rateNumerator,rate.rateDenominator,rateType,
          String(input.exchangeRateSourceName).trim().slice(0,120),String(input.exchangeRateSourceReference).trim().slice(0,180),entry.createdAt,actor.actorId]);
      insertJournalEntry(entry);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',id,'create_draft',actor.actorId,entry.createdAt,JSON.stringify({sourceType:entry.sourceType,entryDate,periodId,description,functionalCurrency:entry.currency,presentationCurrency:entry.presentationCurrency,exchangeRateNumerator:entry.exchangeRateNumerator,exchangeRateDenominator:entry.exchangeRateDenominator,exchangeRateType:entry.exchangeRateType,exchangeRateSource:entry.exchangeRateSource,presentationDebitMinor:entry.presentationDebitMinor,presentationCreditMinor:entry.presentationCreditMinor,debitMinor:entry.debitMinor,creditMinor:entry.creditMinor})]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistAccountingDb(dbSnapshot);
    return accountingJournalWithLines(id);
  });
  registerAccountingHandler('accounting:approve-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La aprobación de asientos está reservada al perfil Contador.');
    const entry=accountingJournalWithLines(String(input.entryId||''));
    if(!entry)throw new Error('El asiento no existe.');
    if(entry.createdBy===actor.actorId)throw new Error('El creador del asiento no puede aprobar su propio asiento.');
    const { approveJournalEntry }=await loadAccountingEngine();
    const approved=approveJournalEntry(entry,{actorId:actor.actorId,actorRole:actor.actorRole});
    const now=approved.approvedAt;
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE journal_entries SET status='approved',approved_at=?,approved_by=? WHERE id=? AND status='draft'",[now,actor.actorId,entry.id]);
      if (db.getRowsModified() !== 1) throw new Error('El asiento cambió de estado antes de ser aprobado.');
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',entry.id,'approve',actor.actorId,now,JSON.stringify({status:entry.status}),JSON.stringify({status:'approved'})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistAccountingDb(dbSnapshot);
    return accountingJournalWithLines(entry.id);
  });
  registerAccountingHandler('accounting:post-journal-entry', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La contabilización está reservada al perfil Contador.');
    const entry=accountingJournalWithLines(String(input.entryId||''));
    if(!entry)throw new Error('El asiento no existe.');
    const periodRow=one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[entry.periodId]);
    const { postJournalEntry }=await loadAccountingEngine();
    const posted=postJournalEntry(entry,periodRow,{actorId:actor.actorId});
    const settings=one('SELECT accounting_framework,functional_currency FROM accounting_settings WHERE id=1');
    if (!settings || settings.functional_currency !== entry.currency) throw new Error('La moneda funcional cambió después de crear el borrador; revisa y vuelve a emitir el asiento.');
    for(const line of entry.lines){
      const account=one('SELECT active,accepts_posting,framework_scope FROM chart_of_accounts WHERE code=?',[line.accountCode]);
      if(!account||Number(account.active)!==1||Number(account.accepts_posting)!==1||(account.framework_scope!=='both'&&account.framework_scope!==settings.accounting_framework))throw new Error('La cuenta '+line.accountCode+' ya no está habilitada para contabilizar.');
    }
    const now=posted.postedAt;
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const lockedPeriod = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [entry.periodId]);
      assertAccountingPeriodWritable(lockedPeriod, entry.entryDate);
      run("UPDATE journal_entries SET status='posted',posted_at=?,posted_by=? WHERE id=? AND status='approved'",[now,actor.actorId,entry.id]);
      if (db.getRowsModified() !== 1) throw new Error('El asiento cambió de estado antes de ser contabilizado.');
      if(entry.reversesEntryId){
        const original=one('SELECT status FROM journal_entries WHERE id=?',[entry.reversesEntryId]);
        if(!original||original.status!=='posted')throw new Error('El asiento original ya no está disponible para reverso.');
        run("UPDATE journal_entries SET status='reversed' WHERE id=? AND status='posted'",[entry.reversesEntryId]);
        if (db.getRowsModified() !== 1) throw new Error('No se pudo marcar el asiento original como reversado.');
      }
      if(entry.sourceType==='asset_depreciation')run("UPDATE accounting_asset_depreciations SET status='posted' WHERE journal_entry_id=? AND status='draft'",[entry.id]);
      if(entry.reversesEntryId)run("UPDATE accounting_asset_depreciations SET status='reversed' WHERE journal_entry_id=? AND status='posted'",[entry.reversesEntryId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',entry.id,'post',actor.actorId,now,JSON.stringify({status:entry.status}),JSON.stringify({status:'posted',reversesEntryId:entry.reversesEntryId})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistAccountingDb(dbSnapshot);
    return accountingJournalWithLines(entry.id);
  });
  registerAccountingHandler('accounting:create-reversal-draft', async (event, input = {}) => {
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
    const dbSnapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const lockedPeriod = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [reversalPeriodId]);
      assertAccountingPeriodWritable(lockedPeriod, reversalDate);
      const currentOriginal=one('SELECT status FROM journal_entries WHERE id=?',[original.id]);
      if(!currentOriginal||currentOriginal.status!=='posted')throw new Error('El asiento original ya no está contabilizado.');
      insertJournalEntry(reversal);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'journal_entry',reversal.id,'create_reversal_draft',actor.actorId,reversal.createdAt,reason,JSON.stringify({originalEntryId:original.id,status:original.status}),JSON.stringify({reversalEntryId:reversal.id,status:'draft',reversalDate,reversalPeriodId})]);
      db.run('COMMIT');
    } catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistAccountingDb(dbSnapshot);
    return accountingJournalWithLines(reversal.id);
  });
  registerAccountingHandler('accounting:list-accounts', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT code,parent_code AS parentCode,name,account_type AS accountType,normal_balance AS normalBalance,
      accepts_posting AS acceptsPosting,active,framework_scope AS frameworkScope,updated_at AS updatedAt
      FROM chart_of_accounts ORDER BY code`);
  });

  registerAccountingHandler('accounting:list-asset-acquisition-entries', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT DISTINCT j.id,j.entry_date AS entryDate,j.description
      FROM journal_entries j JOIN journal_lines l ON l.entry_id=j.id
      JOIN chart_of_accounts a ON a.code=l.account_code
      WHERE j.status='posted' AND a.account_type='asset' AND a.normal_balance='debit'
        AND l.debit_minor>0 AND l.credit_minor=0
      ORDER BY j.entry_date DESC,j.id`);
  });
  registerAccountingHandler('accounting:list-fixed-assets', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT a.id,a.asset_code AS assetCode,a.name,a.description,a.acquisition_date AS acquisitionDate,
      a.available_for_use_date AS availableForUseDate,a.depreciation_start_month AS depreciationStartMonth,
      a.cost_minor AS costMinor,a.residual_minor AS residualMinor,a.useful_life_months AS usefulLifeMonths,
      a.functional_currency AS functionalCurrency,a.asset_account_code AS assetAccountCode,
      a.accumulated_depreciation_account_code AS accumulatedDepreciationAccountCode,
      a.depreciation_expense_account_code AS depreciationExpenseAccountCode,
      a.acquisition_entry_id AS acquisitionEntryId,a.status,
      COALESCE(SUM(CASE WHEN d.status='posted' THEN d.amount_minor ELSE 0 END),0) AS accumulatedMinor,
      COALESCE(SUM(CASE WHEN d.status='draft' THEN d.amount_minor ELSE 0 END),0) AS draftMinor
      FROM accounting_fixed_assets a LEFT JOIN accounting_asset_depreciations d ON d.asset_id=a.id
      GROUP BY a.id ORDER BY a.asset_code`).map(row => {
        const costMinor=Number(row.costMinor),accumulatedMinor=Number(row.accumulatedMinor),draftMinor=Number(row.draftMinor);
        return {...row,costMinor,accumulatedMinor,draftMinor,netBookValueMinor:Math.max(0,costMinor-accumulatedMinor)};
      });
  });
  registerAccountingHandler('accounting:create-fixed-asset', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('El alta de activos fijos está reservada al perfil Contador.');
    const settings=one('SELECT accounting_framework,functional_currency,monetary_decimals FROM accounting_settings WHERE id=1');
    if(!settings||!settings.accounting_framework||!settings.functional_currency)throw new Error('Configura primero la base contable y la moneda funcional.');
    const assetCode=String(input.assetCode||'').trim().toUpperCase();
    const name=String(input.name||'').trim().slice(0,150);
    const description=String(input.description||'').trim().slice(0,500);
    const acquisitionDate=String(input.acquisitionDate||'');
    const availableForUseDate=String(input.availableForUseDate||'');
    const depreciationStartMonth=String(input.depreciationStartMonth||'');
    const acquisitionEntryId=String(input.acquisitionEntryId||'').trim();
    const usefulLifeMonths=Number(input.usefulLifeMonths);
    if(!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(assetCode)||!name||!isValidIsoDate(acquisitionDate)||!isValidIsoDate(availableForUseDate)||availableForUseDate<acquisitionDate||!/^\d{4}-(0[1-9]|1[0-2])$/.test(depreciationStartMonth)||depreciationStartMonth<availableForUseDate.slice(0,7)||!Number.isInteger(usefulLifeMonths)||usefulLifeMonths<1||usefulLifeMonths>1200||!acquisitionEntryId)throw new Error('Completa código, nombre, fechas, mes inicial, vida útil y asiento de adquisición válidos.');
    const {decimalToMinorUnits}=await loadAccountingEngine();
    const costMinor=decimalToMinorUnits(String(input.cost||''),Number(settings.monetary_decimals));
    const residualMinor=decimalToMinorUnits(String(input.residual||'0'),Number(settings.monetary_decimals));
    if(costMinor<=0||residualMinor<0||residualMinor>=costMinor)throw new Error('El costo debe ser mayor que cero y el residual debe ser inferior al costo.');
    const assetAccountCode=String(input.assetAccountCode||'').trim();
    const accumulatedDepreciationAccountCode=String(input.accumulatedDepreciationAccountCode||'').trim();
    const depreciationExpenseAccountCode=String(input.depreciationExpenseAccountCode||'').trim();
    const acquisition=one('SELECT status,functional_currency AS functionalCurrency FROM journal_entries WHERE id=?',[acquisitionEntryId]);
    if(!acquisition||acquisition.status!=='posted'||acquisition.functionalCurrency!==settings.functional_currency)throw new Error('El activo debe vincularse a un asiento de adquisición contabilizado en la moneda funcional.');
    const acquisitionLine=one('SELECT COUNT(*) AS total FROM journal_lines WHERE entry_id=? AND account_code=? AND debit_minor=? AND credit_minor=0',[acquisitionEntryId,assetAccountCode,costMinor]);
    if(Number(acquisitionLine.total)!==1)throw new Error('El asiento de adquisición debe contener exactamente un renglón Debe por el costo del activo en la cuenta seleccionada.');
    const assetAccount=one('SELECT account_type AS accountType,normal_balance AS normalBalance,active,accepts_posting AS acceptsPosting,framework_scope AS frameworkScope FROM chart_of_accounts WHERE code=?',[assetAccountCode]);
    const accumAccount=one('SELECT account_type AS accountType,normal_balance AS normalBalance,active,accepts_posting AS acceptsPosting,framework_scope AS frameworkScope FROM chart_of_accounts WHERE code=?',[accumulatedDepreciationAccountCode]);
    const expenseAccount=one('SELECT account_type AS accountType,normal_balance AS normalBalance,active,accepts_posting AS acceptsPosting,framework_scope AS frameworkScope FROM chart_of_accounts WHERE code=?',[depreciationExpenseAccountCode]);
    const validAccount=(account,type,balance)=>account&&account.accountType===type&&account.normalBalance===balance&&Number(account.active)===1&&Number(account.acceptsPosting)===1&&(account.frameworkScope==='both'||account.frameworkScope===settings.accounting_framework);
    if(!validAccount(assetAccount,'asset','debit')||!validAccount(accumAccount,'asset','credit')||!validAccount(expenseAccount,'expense','debit'))throw new Error('Selecciona cuentas activas e imputables: activo Debe, depreciación acumulada Haber y gasto Debe.');
    const id=crypto.randomUUID(),now=new Date().toISOString(),snapshot=db.export();
    db.run('BEGIN IMMEDIATE');
    try{
      const lockedSettings=one('SELECT accounting_framework,functional_currency,monetary_decimals FROM accounting_settings WHERE id=1');
      if(!lockedSettings||lockedSettings.accounting_framework!==settings.accounting_framework||lockedSettings.functional_currency!==settings.functional_currency||Number(lockedSettings.monetary_decimals)!==Number(settings.monetary_decimals))throw new Error('La configuración contable cambió durante el alta del activo.');
      const lockedAcquisition=one('SELECT status,functional_currency AS functionalCurrency FROM journal_entries WHERE id=?',[acquisitionEntryId]);
      if(!lockedAcquisition||lockedAcquisition.status!=='posted'||lockedAcquisition.functionalCurrency!==lockedSettings.functional_currency)throw new Error('El asiento de adquisición dejó de estar contabilizado.');
      const duplicate=one('SELECT id FROM accounting_fixed_assets WHERE acquisition_entry_id=? AND asset_account_code=? AND cost_minor=?',[acquisitionEntryId,assetAccountCode,costMinor]);
      if(duplicate)throw new Error('Ese renglón de adquisición ya está vinculado a un activo fijo.');
      run(`INSERT INTO accounting_fixed_assets(id,asset_code,name,description,acquisition_date,available_for_use_date,depreciation_start_month,cost_minor,residual_minor,useful_life_months,functional_currency,asset_account_code,accumulated_depreciation_account_code,depreciation_expense_account_code,acquisition_entry_id,status,created_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,[id,assetCode,name,description,acquisitionDate,availableForUseDate,depreciationStartMonth,costMinor,residualMinor,usefulLifeMonths,settings.functional_currency,assetAccountCode,accumulatedDepreciationAccountCode,depreciationExpenseAccountCode,acquisitionEntryId,now,actor.actorId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',[crypto.randomUUID(),'fixed_asset',id,'create',actor.actorId,now,JSON.stringify({assetCode,name,acquisitionDate,availableForUseDate,depreciationStartMonth,costMinor,residualMinor,usefulLifeMonths,functionalCurrency:settings.functional_currency,assetAccountCode,accumulatedDepreciationAccountCode,depreciationExpenseAccountCode,acquisitionEntryId})]);
      db.run('COMMIT');
    }catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
    persistAccountingDb(snapshot);
    return one('SELECT id,asset_code AS assetCode,name,status FROM accounting_fixed_assets WHERE id=?',[id]);
  });
  registerAccountingHandler('accounting:generate-asset-depreciation-drafts', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor=accountingActor(input);
    if(actor.actorRole!=='contador')throw new Error('La depreciación de activos fijos está reservada al perfil Contador.');
    const periodId=String(input.periodId||'').trim();
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId))throw new Error('Selecciona un período AAAA-MM válido.');
    const period=one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[periodId]);
    assertAccountingPeriodWritable(period);
    const settings=one('SELECT accounting_framework,functional_currency,presentation_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
    if(!settings||!settings.accounting_framework||!settings.functional_currency||!settings.presentation_currency)throw new Error('Configura primero el marco y las monedas contables.');
    const rateType=String(input.exchangeRateType||'official');
    if(settings.functional_currency!==settings.presentation_currency&&!['official','market','contractual','accounting_adjustment'].includes(rateType))throw new Error('Selecciona el tipo de tasa documentada para presentar la depreciación.');
    const {createJournalEntry}=await loadAccountingEngine();
    const {buildBimonetaryLines}=await import('../src/accounting/bimonetary.mjs');
    const {calculateStraightLineDepreciation}=await import('../src/accounting/fixed-assets.mjs');
    const assets=all("SELECT * FROM accounting_fixed_assets WHERE status='active' AND depreciation_start_month<=? AND available_for_use_date<=? ORDER BY asset_code",[periodId,period.endDate]);
    const generated=[],skipped=[],needsReview=[];
    const monthIndex=(start,target)=>(Number(target.slice(0,4))-Number(start.slice(0,4)))*12+Number(target.slice(5,7))-Number(start.slice(5,7));
    for(const asset of assets){
      try{
        const existing=one('SELECT id,status FROM accounting_asset_depreciations WHERE asset_id=? AND depreciation_month=?',[asset.id,periodId]);
        if(existing){skipped.push({assetCode:asset.asset_code,reason:'La depreciación de este mes ya tiene registro ('+existing.status+').'});continue;}
        const expectedMonths=monthIndex(asset.depreciation_start_month,periodId);
        const previous=one("SELECT COUNT(*) AS total,COALESCE(SUM(amount_minor),0) AS amount FROM accounting_asset_depreciations WHERE asset_id=? AND depreciation_month<? AND status='posted'",[asset.id,periodId]);
        const previousCount=Number(previous.total||0);
        if(previousCount!==expectedMonths){needsReview.push({assetCode:asset.asset_code,reason:'Hay períodos anteriores sin depreciación contabilizada. Genera o regulariza primero los meses pendientes.'});continue;}
        const amountMinor=calculateStraightLineDepreciation({costMinor:Number(asset.cost_minor),residualMinor:Number(asset.residual_minor),usefulLifeMonths:Number(asset.useful_life_months),monthsAlreadyDepreciated:previousCount});
        if(amountMinor<=0){skipped.push({assetCode:asset.asset_code,reason:'Vida útil agotada o valor depreciable completado.'});continue;}
        let rate={rateNumerator:1,rateDenominator:1},rateId=null,rateSource=null,rateTypeUsed=null;
        if(settings.functional_currency!==settings.presentation_currency){
          const rateRow=one('SELECT id,rate_numerator AS rateNumerator,rate_denominator AS rateDenominator,source_name AS sourceName,source_reference AS sourceReference,rate_type AS rateType FROM accounting_exchange_rates WHERE rate_date=? AND from_currency=? AND to_currency=? AND rate_type=? ORDER BY recorded_at DESC LIMIT 1',[period.endDate,settings.functional_currency,settings.presentation_currency,rateType]);
          if(!rateRow){needsReview.push({assetCode:asset.asset_code,reason:'No existe una tasa '+rateType+' documentada para '+period.endDate+'.'});continue;}
          rate={rateNumerator:Number(rateRow.rateNumerator),rateDenominator:Number(rateRow.rateDenominator)};
          rateId=rateRow.id;rateSource=rateRow.sourceName+' · '+rateRow.sourceReference;rateTypeUsed=rateRow.rateType;
        }
        const lines=[
          {accountCode:asset.depreciation_expense_account_code,debitMinor:amountMinor,creditMinor:0,description:'Depreciación '+asset.asset_code+' '+periodId},
          {accountCode:asset.accumulated_depreciation_account_code,debitMinor:0,creditMinor:amountMinor,description:'Depreciación acumulada '+asset.asset_code+' '+periodId}
        ];
        const converted=buildBimonetaryLines({lines,functionalCurrency:settings.functional_currency,presentationCurrency:settings.presentation_currency,functionalDecimals:Number(settings.monetary_decimals),presentationDecimals:Number(settings.monetary_decimals),rateNumerator:rate.rateNumerator,rateDenominator:rate.rateDenominator});
        const depreciationId=crypto.randomUUID(),entryId=crypto.randomUUID(),createdAt=new Date().toISOString();
        const entry=createJournalEntry({id:entryId,sourceType:'asset_depreciation',sourceId:depreciationId,entryDate:period.endDate,periodId,currency:settings.functional_currency,ruleVersion:'FIXED-ASSET-SL-v1 / '+settings.policy_version,description:'Depreciación mensual '+asset.asset_code+' · '+asset.name+' · '+periodId,lines:converted.lines,createdAt,createdBy:actor.actorId});
        Object.assign(entry,{presentationCurrency:settings.presentation_currency,exchangeRateId:rateId,exchangeRateNumerator:rate.rateNumerator,exchangeRateDenominator:rate.rateDenominator,exchangeRateType:rateTypeUsed,exchangeRateSource:rateSource,presentationDebitMinor:converted.presentationDebitMinor,presentationCreditMinor:converted.presentationCreditMinor});
        const snapshot=db.export();db.run('BEGIN IMMEDIATE');
        try{
          const lockedPeriod=one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?',[periodId]);
          assertAccountingPeriodWritable(lockedPeriod,period.endDate);
          const lockedAsset=one("SELECT status FROM accounting_fixed_assets WHERE id=?",[asset.id]);
          if(!lockedAsset||lockedAsset.status!=='active')throw new Error('El activo cambió de estado durante la generación.');
          const duplicate=one('SELECT id FROM accounting_asset_depreciations WHERE asset_id=? AND depreciation_month=?',[asset.id,periodId]);
          if(duplicate)throw new Error('Otra sesión ya generó la depreciación de este activo.');
          const lockedPrevious=one("SELECT COUNT(*) AS total FROM accounting_asset_depreciations WHERE asset_id=? AND depreciation_month<? AND status='posted'",[asset.id,periodId]);
          if(Number(lockedPrevious.total||0)!==expectedMonths)throw new Error('La depreciación anterior cambió durante la generación.');
          const lockedSettings=one('SELECT functional_currency,presentation_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
          if(!lockedSettings||lockedSettings.functional_currency!==settings.functional_currency||lockedSettings.presentation_currency!==settings.presentation_currency||Number(lockedSettings.monetary_decimals)!==Number(settings.monetary_decimals)||lockedSettings.policy_version!==settings.policy_version)throw new Error('La política contable cambió durante la generación.');
          insertJournalEntry(entry);
          run("INSERT INTO accounting_asset_depreciations(id,asset_id,period_id,depreciation_month,depreciation_date,amount_minor,presentation_amount_minor,journal_entry_id,status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?, 'draft',?,?)",[depreciationId,asset.id,periodId,periodId,period.endDate,amountMinor,converted.presentationDebitMinor,entryId,createdAt,actor.actorId]);
          run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',[crypto.randomUUID(),'fixed_asset_depreciation',depreciationId,'generate_draft',actor.actorId,createdAt,JSON.stringify({assetId:asset.id,assetCode:asset.asset_code,periodId,amountMinor,journalEntryId:entryId,rateId,rateType:rateTypeUsed})]);
          db.run('COMMIT');
        }catch(error){try{db.run('ROLLBACK')}catch{}throw error;}
        persistAccountingDb(snapshot);
        generated.push({assetCode:asset.asset_code,journalEntryId:entryId,amountMinor});
      }catch(error){needsReview.push({assetCode:asset.asset_code,reason:String(error.message||error).slice(0,400)});}
    }
    return {generated,skipped,needsReview};
  });
  registerAccountingHandler('accounting:get-general-ledger', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    accountingActor(input);
    const accountCode = String(input.accountCode || '').trim();
    const startDate = String(input.startDate || '');
    const endDate = String(input.endDate || '');
    if (!accountCode || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) throw new Error('Selecciona una cuenta y un rango de fechas válido para consultar el mayor.');
    const account = one('SELECT code,name,account_type AS accountType,normal_balance AS normalBalance FROM chart_of_accounts WHERE code=?', [accountCode]);
    if (!account) throw new Error('La cuenta seleccionada no existe en el plan contable.');
    const rows = all(`SELECT j.entry_date AS entryDate,j.id AS entryId,j.source_type AS sourceType,j.source_id AS sourceId,
      j.description AS entryDescription,l.line_no AS lineNo,l.description AS lineDescription,
      l.debit_minor AS debitMinor,l.credit_minor AS creditMinor,
      l.presentation_debit_minor AS presentationDebitMinor,l.presentation_credit_minor AS presentationCreditMinor
      FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id
      WHERE l.account_code=? AND j.status IN ('posted','reversed') AND j.entry_date<=?
      ORDER BY j.entry_date,j.created_at,j.id,l.line_no`, [accountCode,endDate]).map(row => ({
        ...row,debitMinor:Number(row.debitMinor),creditMinor:Number(row.creditMinor),
        presentationDebitMinor:row.presentationDebitMinor==null?null:Number(row.presentationDebitMinor),
        presentationCreditMinor:row.presentationCreditMinor==null?null:Number(row.presentationCreditMinor),
        lineNo:Number(row.lineNo)
      }));
    const { buildGeneralLedger } = require('./accounting-reports.cjs');
    return { account, ...buildGeneralLedger({ rows,startDate,endDate,normalBalance:account.normalBalance }) };
  });
  registerAccountingHandler('accounting:get-financial-statements', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    accountingActor(input);
    const periodId = String(input.periodId || '').trim();
    const period = one('SELECT id,label,start_date AS startDate,end_date AS endDate FROM accounting_periods WHERE id=?', [periodId]);
    if (!period) throw new Error('Selecciona un período contable existente para emitir los estados financieros.');
    const accounts = all('SELECT code,parent_code AS parentCode,name,account_type AS accountType,normal_balance AS normalBalance,accepts_posting AS acceptsPosting FROM chart_of_accounts ORDER BY code');
    const rows = all(`SELECT l.account_code AS accountCode,l.debit_minor AS debitMinor,l.credit_minor AS creditMinor,j.entry_date AS entryDate
      FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id
      WHERE j.status IN ('posted','reversed') AND j.entry_date<=?
      ORDER BY j.entry_date,j.id,l.line_no`, [period.endDate]).map(row => ({...row,debitMinor:Number(row.debitMinor),creditMinor:Number(row.creditMinor)}));
    const { buildFinancialStatements } = require('./accounting-reports.cjs');
    return { period, ...buildFinancialStatements({accounts,rows,periodStart:period.startDate,periodEnd:period.endDate}) };
  });
  registerAccountingHandler('accounting:list-automation-rules', (event, token) => {
    assertTrustedAccountingSender(event);
    requireAccountingSession(token, { allowedRoles: ['admin', 'contador'] });
    return all(`SELECT id,source_type AS sourceType,event_action AS eventAction,amount_path AS amountPath,
      currency_path AS currencyPath,debit_account_code AS debitAccountCode,credit_account_code AS creditAccountCode,
      description_template AS descriptionTemplate,exchange_rate_type AS exchangeRateType,rule_version AS ruleVersion,
      status,created_at AS createdAt,created_by AS createdBy
      FROM accounting_automation_rules ORDER BY source_type,event_action,rule_version DESC`);
  });
  registerAccountingHandler('accounting:save-automation-rule', (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const sourceType = String(input.sourceType || '').trim();
    const eventAction = String(input.eventAction || 'created');
    const amountPath = String(input.amountPath || '').trim();
    const currencyPath = String(input.currencyPath || '').trim();
    const debitAccountCode = String(input.debitAccountCode || '').trim();
    const creditAccountCode = String(input.creditAccountCode || '').trim();
    const descriptionTemplate = String(input.descriptionTemplate || '').trim().slice(0, 180);
    const exchangeRateType = String(input.exchangeRateType || '').trim();
    const allowedSources = new Set(['sale','purchase','receivable','payable','cash_close','cash_opening','cash_movement','inventory_movement','held_sale','inventory_count','return','void','cashea_operation','cashea_settlement','currency_movement','iva_retention','islr_retention','bank_operation','bank_settlement_batch','exchange_rate_update','fiscal_inventory_movement','retention']);
    const safePath = value => !value || isSafeAutomationPath(value);
    if (!allowedSources.has(sourceType)) throw new Error('Tipo de operación contable no reconocido.');
    if (eventAction !== 'created') throw new Error('Por seguridad, la generación automática inicial solo admite altas. Las modificaciones y eliminaciones requieren revisión y ajuste manual.');
    if (!safePath(amountPath) || !amountPath) throw new Error('Indica una ruta de importe válida, por ejemplo total o totals.grandTotal.');
    if (!safePath(currencyPath)) throw new Error('La ruta de moneda no es válida.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(debitAccountCode) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(creditAccountCode) || debitAccountCode === creditAccountCode) throw new Error('Selecciona dos cuentas imputables distintas.');
    if (!descriptionTemplate) throw new Error('La descripción del asiento es obligatoria.');
    if (exchangeRateType && !['official','market','contractual','accounting_adjustment'].includes(exchangeRateType)) throw new Error('Tipo de tasa bimonetaria no válido.');
    const settings = one('SELECT accounting_framework,presentation_currency,functional_currency FROM accounting_settings WHERE id=1');
    if (!settings || !settings.accounting_framework) throw new Error('Configura primero el marco VEN-NIF y las monedas.');
    for (const code of [debitAccountCode, creditAccountCode]) {
      const account = one('SELECT active,accepts_posting,framework_scope FROM chart_of_accounts WHERE code=?', [code]);
      if (!account || Number(account.active)!==1 || Number(account.accepts_posting)!==1 || (account.framework_scope!=='both' && account.framework_scope!==settings.accounting_framework)) throw new Error('La cuenta '+code+' no está habilitada para contabilizaciones en el marco configurado.');
    }
    const current = one("SELECT MAX(rule_version) AS version FROM accounting_automation_rules WHERE source_type=? AND event_action=?", [sourceType,eventAction]);
    const version = Number(current && current.version || 0) + 1;
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const snapshot = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      run("UPDATE accounting_automation_rules SET status='retired' WHERE source_type=? AND event_action=? AND status='active'", [sourceType,eventAction]);
      run(`INSERT INTO accounting_automation_rules(id,source_type,event_action,amount_path,currency_path,debit_account_code,credit_account_code,description_template,exchange_rate_type,rule_version,status,created_at,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?, 'active',?,?)`,
        [id,sourceType,eventAction,amountPath,currencyPath,debitAccountCode,creditAccountCode,descriptionTemplate,exchangeRateType||null,version,now,actor.actorId]);
      run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',
        [crypto.randomUUID(),'accounting_automation_rule',id,'create_version',actor.actorId,now,JSON.stringify({sourceType,eventAction,amountPath,currencyPath,debitAccountCode,creditAccountCode,descriptionTemplate,exchangeRateType,version})]);
      db.run('COMMIT');
    } catch(error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    persistAccountingDb(snapshot);
    return one('SELECT id,source_type AS sourceType,event_action AS eventAction,amount_path AS amountPath,currency_path AS currencyPath,debit_account_code AS debitAccountCode,credit_account_code AS creditAccountCode,description_template AS descriptionTemplate,exchange_rate_type AS exchangeRateType,rule_version AS ruleVersion,status FROM accounting_automation_rules WHERE id=?',[id]);
  });
  registerAccountingHandler('accounting:generate-source-drafts', async (event, input = {}) => {
    assertTrustedAccountingSender(event);
    const actor = accountingActor(input);
    const settings = one('SELECT accounting_framework,functional_currency,presentation_currency,monetary_decimals,automation_mode,policy_version FROM accounting_settings WHERE id=1');
    if (!settings || !settings.accounting_framework || !settings.functional_currency || !settings.presentation_currency) throw new Error('Configura primero el marco VEN-NIF y las monedas.');
    if (settings.automation_mode !== 'supervised') throw new Error('La generación de borradores está desactivada en modo «solo sugerencias». Cambia el modo a supervisado para crear borradores revisables.');
    const requestedId = String(input.eventId || '').trim();
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
    const pending = requestedId
      ? all("SELECT * FROM accounting_source_events WHERE event_id=? AND processing_status IN ('pending','needs_review')", [requestedId])
      : all("SELECT * FROM accounting_source_events WHERE processing_status='pending' ORDER BY occurred_at,event_id LIMIT ?", [limit]);
    if (requestedId && !pending.length) throw new Error('El evento no existe o ya fue procesado.');
    const { createJournalEntry, decimalToMinorUnits } = await loadAccountingEngine();
    const { buildBimonetaryLines } = await import('../src/accounting/bimonetary.mjs');
    const { extractAutomationValue, isSafeAutomationPath } = require('./accounting-automation.cjs');
    const results = { generated: [], needsReview: [], skipped: [] };
    for (const sourceEvent of pending) {
      try {
        if (sourceEvent.processing_status === 'processed') { results.skipped.push({eventId:sourceEvent.event_id,reason:'Ya procesado'}); continue; }
        const existingEntry = one('SELECT id,status FROM journal_entries WHERE source_type=? AND source_id=?', ['automation:'+sourceEvent.source_type,sourceEvent.event_id]);
        if (existingEntry) {
          const snapshot = db.export();
          db.run('BEGIN IMMEDIATE');
          try {
            run("UPDATE accounting_source_events SET processing_status='processed',journal_entry_id=?,processed_at=?,error_message='' WHERE event_id=?",
              [existingEntry.id,new Date().toISOString(),sourceEvent.event_id]);
            run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',
              [crypto.randomUUID(),'accounting_source_event',sourceEvent.event_id,'reconcile_existing_draft',actor.actorId,new Date().toISOString(),JSON.stringify({journalEntryId:existingEntry.id})]);
            db.run('COMMIT');
          } catch(error) { try { db.run('ROLLBACK'); } catch {} throw error; }
          persistAccountingDb(snapshot);
          results.skipped.push({eventId:sourceEvent.event_id,reason:'El borrador ya existe',journalEntryId:existingEntry.id});
          continue;
        }
        let payload;
        try { payload = JSON.parse(sourceEvent.payload_json); } catch { throw new Error('El evento contiene datos no legibles.'); }
        if (payload.action !== 'created') throw new Error('Las modificaciones y eliminaciones requieren ajuste contable revisado; no se automatizan.');
        const rule = one("SELECT * FROM accounting_automation_rules WHERE source_type=? AND event_action='created' AND status='active' ORDER BY rule_version DESC LIMIT 1", [sourceEvent.source_type]);
        if (!rule) throw new Error('No existe una regla activa para esta operación. Configura la asignación de cuentas e importe.');
        const record = payload.record;
        const rawAmount = extractAutomationValue(record, rule.amount_path);
        if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') throw new Error('La ruta de importe configurada no existe en el documento de origen.');
        const amountMinor = decimalToMinorUnits(String(rawAmount), Number(settings.monetary_decimals));
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('El importe de origen debe ser mayor que cero.');
        const currency = rule.currency_path ? String(extractAutomationValue(record, rule.currency_path) || '').trim().toUpperCase() : settings.functional_currency;
        if (currency !== settings.functional_currency) throw new Error('La moneda del documento ('+currency+') no coincide con la moneda funcional. Requiere conversión y revisión explícita.');
        const entryDate = String(sourceEvent.occurred_at || '').slice(0,10);
        if (!isValidIsoDate(entryDate)) throw new Error('El evento no tiene una fecha contable válida.');
        const period = one("SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE start_date<=? AND end_date>=? ORDER BY start_date LIMIT 1", [entryDate,entryDate]);
        if (!period || period.status !== 'open') throw new Error('No existe un período contable abierto para la fecha del evento.');
        const lines = [
          {accountCode:rule.debit_account_code,debitMinor:amountMinor,creditMinor:0,description:rule.description_template.slice(0,180)},
          {accountCode:rule.credit_account_code,debitMinor:0,creditMinor:amountMinor,description:rule.description_template.slice(0,180)}
        ];
        const presentationCurrency = settings.presentation_currency;
        let rate = {rateNumerator:1,rateDenominator:1}, rateId=null, rateType=null, rateSource=null;
        if (settings.functional_currency !== presentationCurrency) {
          if (!rule.exchange_rate_type) throw new Error('La regla no especifica el tipo de tasa para convertir a moneda de presentación.');
          const rateRow = one("SELECT id,rate_numerator AS rateNumerator,rate_denominator AS rateDenominator,rate_type AS rateType,source_name AS sourceName,source_reference AS sourceReference FROM accounting_exchange_rates WHERE rate_date=? AND from_currency=? AND to_currency=? AND rate_type=? ORDER BY recorded_at DESC LIMIT 1",
            [entryDate,settings.functional_currency,presentationCurrency,rule.exchange_rate_type]);
          if (!rateRow) throw new Error('No existe una tasa '+rule.exchange_rate_type+' documentada para la fecha del evento. Regístrala antes de generar el borrador.');
          rate = {rateNumerator:Number(rateRow.rateNumerator),rateDenominator:Number(rateRow.rateDenominator)};
          rateId = rateRow.id; rateType=rateRow.rateType; rateSource=rateRow.sourceName+' · '+rateRow.sourceReference;
        }
        const converted = buildBimonetaryLines({lines,functionalCurrency:settings.functional_currency,presentationCurrency,
          functionalDecimals:Number(settings.monetary_decimals),presentationDecimals:Number(settings.monetary_decimals),
          rateNumerator:rate.rateNumerator,rateDenominator:rate.rateDenominator});
        const description = rule.description_template.replace(/\{sourceId\}/g,String(sourceEvent.source_id)).replace(/\{date\}/g,entryDate).slice(0,500);
        const id = crypto.randomUUID(), createdAt = new Date().toISOString();
        const entry = createJournalEntry({id,sourceType:'automation:'+sourceEvent.source_type,sourceId:sourceEvent.event_id,
          entryDate,periodId:period.id,currency:settings.functional_currency,
          ruleVersion:'AUTO-'+rule.id+'-v'+rule.rule_version+' / '+settings.policy_version,
          description,lines:converted.lines,createdAt,createdBy:actor.actorId});
        Object.assign(entry,{presentationCurrency,exchangeRateId:rateId,exchangeRateNumerator:rate.rateNumerator,
          exchangeRateDenominator:rate.rateDenominator,exchangeRateType:rateType,exchangeRateSource:rateSource,
          presentationDebitMinor:converted.presentationDebitMinor,presentationCreditMinor:converted.presentationCreditMinor});
        const snapshot = db.export();
        db.run('BEGIN IMMEDIATE');
        try {
          const stillPending = one("SELECT processing_status FROM accounting_source_events WHERE event_id=?", [sourceEvent.event_id]);
          if (!stillPending || !['pending','needs_review'].includes(stillPending.processing_status)) throw new Error('El evento fue procesado por otra sesión.');
          const lockedPeriod = one('SELECT id,start_date AS startDate,end_date AS endDate,status FROM accounting_periods WHERE id=?', [period.id]);
          assertAccountingPeriodWritable(lockedPeriod, entryDate);
          const lockedSettings = one('SELECT functional_currency,presentation_currency,monetary_decimals,policy_version FROM accounting_settings WHERE id=1');
          if (!lockedSettings || lockedSettings.functional_currency !== settings.functional_currency || lockedSettings.presentation_currency !== settings.presentation_currency || Number(lockedSettings.monetary_decimals) !== Number(settings.monetary_decimals) || lockedSettings.policy_version !== settings.policy_version) throw new Error('La política contable cambió durante la preparación del borrador. Vuelve a revisar el evento.');
          const lockedRule = one('SELECT status FROM accounting_automation_rules WHERE id=?', [rule.id]);
          if (!lockedRule || lockedRule.status !== 'active') throw new Error('La regla cambió mientras se preparaba el borrador. Revisa y vuelve a procesar el evento.');
          insertJournalEntry(entry);
          run("UPDATE accounting_source_events SET processing_status='processed',journal_entry_id=?,processed_at=?,error_message='' WHERE event_id=?",
            [entry.id,createdAt,sourceEvent.event_id]);
          run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,after_json) VALUES(?,?,?,?,?,?,?)',
            [crypto.randomUUID(),'accounting_source_event',sourceEvent.event_id,'generate_draft',actor.actorId,createdAt,JSON.stringify({journalEntryId:entry.id,ruleId:rule.id,ruleVersion:rule.rule_version,amountMinor,currency,entryDate})]);
          db.run('COMMIT');
        } catch(error) { try { db.run('ROLLBACK'); } catch {} throw error; }
        persistAccountingDb(snapshot);
        results.generated.push({eventId:sourceEvent.event_id,journalEntryId:entry.id,entryDate,amountMinor,currency});
      } catch(error) {
        const reason = String(error && error.message || error).slice(0,500);
        const snapshot = db.export();
        db.run('BEGIN IMMEDIATE');
        try {
          run("UPDATE accounting_source_events SET processing_status='needs_review',error_message=? WHERE event_id=? AND processing_status IN ('pending','needs_review')", [reason,sourceEvent.event_id]);
          run('INSERT INTO accounting_audit_log(id,entity_type,entity_id,action,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?,?)',
            [crypto.randomUUID(),'accounting_source_event',sourceEvent.event_id,'automation_needs_review',actor.actorId,new Date().toISOString(),reason]);
          db.run('COMMIT');
        } catch(auditError) { try { db.run('ROLLBACK'); } catch {} throw auditError; }
        persistAccountingDb(snapshot);
        results.needsReview.push({eventId:sourceEvent.event_id,reason});
      }
    }
    return results;
  });
  registerAccountingHandler('accounting:save-account', (event, input = {}) => {
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
    const dbSnapshot = db.export();
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
    persistAccountingDb(dbSnapshot);
    return one('SELECT code,parent_code AS parentCode,name,account_type AS accountType,normal_balance AS normalBalance,accepts_posting AS acceptsPosting,active,framework_scope AS frameworkScope FROM chart_of_accounts WHERE code=?',[code]);
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
    const before = Number(one('SELECT COUNT(*) AS total FROM app_users').total || 0);
    if (before > 0) {
      const existing = all('SELECT username,name,role,cashbox FROM app_users WHERE active=1 ORDER BY username');
      return { migrated:false, synchronized:false, count:existing.length, users:existing, reason:'bootstrap-already-completed' };
    }
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
    if (Number(one('SELECT COUNT(*) AS total FROM app_users').total || 0) > 0) {
      const existing = all('SELECT username,name,role,cashbox FROM app_users WHERE active=1 ORDER BY username');
      return { migrated:false, synchronized:false, count:existing.length, users:existing, reason:'bootstrap-already-completed' };
    }
    persistMutation(() => {
      db.run('BEGIN IMMEDIATE');
      try {
        for (const user of prepared) run(
          'INSERT INTO app_users(username,name,role,cashbox,password_hash,active) VALUES(?,?,?,?,?,1)',
          [user.username,user.name,user.role,user.cashbox,user.password_hash]
        );
        run("INSERT OR REPLACE INTO schema_migrations(migration_key) VALUES('auth-users-scrypt-v1')");
        db.run('COMMIT');
      } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    });
    const migrated = all('SELECT username,name,role,cashbox FROM app_users WHERE active=1 ORDER BY username');
    if (migrated.length !== prepared.length) throw new Error('La inicialización de usuarios en SQLite no coincide; conserve los datos heredados.');
    return { migrated:true, synchronized:true, count:migrated.length, users:migrated };
  });
  ipcMain.handle('auth:login', async (_event, credentials = {}) => {
    if(networkConfig.role==='client'){
      const result=await clientApi('/api/auth/login',{method:'POST',body:JSON.stringify({username:String(credentials.username||''),password:String(credentials.password||'')}),timeoutMs:12000});
      return result;
    }
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
    if(networkConfig.role==='client'){
      return clientApi('/api/auth/session',{method:'POST',body:JSON.stringify({token:String(token||'')}),timeoutMs:10000}).catch(()=>({user:null,valid:false}));
    }
    try { return { user: requireAuthSession(token), valid: true }; }
    catch { return { user: null, valid: false }; }
  });
  ipcMain.handle('auth:logout', async (_event, token) => {
    if(networkConfig.role==='client'){
      try{return await clientApi('/api/auth/logout',{method:'POST',body:JSON.stringify({token:String(token||'')}),timeoutMs:8000});}catch{return {ok:false};}
    }
    authSessions.delete(String(token || '')); return { ok: true };
  });
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
      if (session.user.username.toLowerCase() === username.toLowerCase()) {
        if (sessionToken === String(token)) authSessions.set(sessionToken, { user:{username,name,role,cashbox}, expiresAt:session.expiresAt });
        else authSessions.delete(sessionToken);
      }
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
  ipcMain.handle('license:status', () => licensing.status());
  ipcMain.handle('license:refresh', () => licensing.refresh(true));
  ipcMain.handle('license:activate', async (_event, licenseKey) => licensing.activate(licenseKey));
  ipcMain.handle('license:set-telemetry', (_event, enabled) => licensing.setTelemetryEnabled(enabled));
  ipcMain.handle('license:open-plans', () => licensing.openPlans());
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
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Estado POS inválido.');
    const payload = JSON.stringify(state);
    const currentRow = one('SELECT payload FROM app_state WHERE id=1');
    const previousState = currentRow ? JSON.parse(currentRow.payload) : {};
    const accountingEvents = buildAccountingSourceEvents(previousState, state, { deviceId: networkConfig.deviceId });
    // El estado comercial y sus eventos contables se guardan juntos; no se confirma uno sin el otro.
    persistMutation(() => {
      run('INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP', [payload]);
      insertAccountingSourceEvents(accountingEvents);
    });
    clearTimeout(saveTimer);
    saveTimer = null;
    return { ok: true, durable: 'sqlite-file', accountingEventsCaptured: accountingEvents.length };
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
  ipcMain.handle('printer:test', async (_e, printerName, options = {}) => PrinterManager.printTicket(printerName, 'SIFER360 LICORERIA\nPRUEBA DE IMPRESION\nTicket no fiscal\n\n', { columns: Number(options.columns)||42 }));
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
  ipcMain.handle('app-update:check', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'development-build' };
    try { const result = await autoUpdater.checkForUpdates(); return { ok: true, version: result && result.updateInfo && result.updateInfo.version || null }; }
    catch (error) { return { ok: false, error: String(error && error.message || error) }; }
  });
  ipcMain.handle('app-update:install', async () => {
    if (!updateDownloaded) throw new Error('La actualización todavía no terminó de descargarse.');
    if (networkConfig.role === 'server' && networkServer) throw new Error('Cierre todas las cajas cliente y detenga el servidor LAN antes de actualizar el equipo servidor.');
    if (networkConfig.role !== 'client' && db) {
      const integrity = databaseIntegrityStatus(db);
      if (integrity !== 'ok') throw new Error('SQLite no superó integrity_check; se canceló la instalación para proteger los datos.');
      persistDb();
      if (databaseIntegrityStatus(db) !== 'ok') throw new Error('No se pudo confirmar la integridad de SQLite antes de actualizar.');
      const backupDir = path.join(app.getPath('userData'), 'update-backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, 'sifer360-preupdate-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
      const backupBytes = Buffer.from(db.export());
      const backupCheck = new SqlDatabase(new Uint8Array(backupBytes));
      if (databaseIntegrityStatus(backupCheck) !== 'ok') { try { backupCheck.close(); } catch {} throw new Error('El respaldo previo a la actualización no superó la verificación de integridad.'); }
      try { backupCheck.close(); } catch {}
      const backupTemporary = backupPath + '.tmp';
      let backupFd;
      try {
        backupFd = fs.openSync(backupTemporary, 'wx', 0o600);
        fs.writeFileSync(backupFd, backupBytes);
        fs.fsyncSync(backupFd);
        fs.closeSync(backupFd);
        backupFd = undefined;
        fs.renameSync(backupTemporary, backupPath);
      } catch (backupError) {
        if (backupFd !== undefined) { try { fs.closeSync(backupFd); } catch {} }
        try { if (fs.existsSync(backupTemporary)) fs.unlinkSync(backupTemporary); } catch {}
        throw new Error('No se pudo escribir de forma durable el respaldo previo a la actualización. La actualización fue cancelada. ' + (backupError.message || String(backupError)));
      }
      const writtenBackup = fs.readFileSync(backupPath);
      if (!writtenBackup.equals(backupBytes)) throw new Error('No se pudo verificar el respaldo previo a la actualización.');
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
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
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--sifer-google-drive-backup')) {
      try { legacyBackupTaskRetirer.remove(); } catch (error) { console.warn('No se pudo retirar la antigua tarea de respaldo:', error.message); }
      return;
    }
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) { if (existing.isMinimized()) existing.restore(); existing.focus(); }
  });
  app.whenReady().then(async () => {
    readNetworkConfig();
    if (networkConfig.role !== 'client') await initializeDatabase();
    if (process.argv.includes('--sifer-google-drive-backup')) {
      try { legacyBackupTaskRetirer.remove(); } catch (error) { console.warn('No se pudo retirar la antigua tarea de respaldo:', error.message); }
      app.quit();
      return;
    }
    try { legacyBackupTaskRetirer.remove(); } catch (error) { console.warn('No se pudo retirar la antigua tarea de respaldo:', error.message); }
    licensing = createLicensing({ app, safeStorage, shell });
    await licensing.initialize();
    registerIpc();
    registerAccountingIpc();
    registerNetworkIpc();
    if (networkConfig.role === 'server') { try { await startLanServer(networkConfig.port); } catch (error) { throw new Error('No se pudo reanudar el servidor LAN. SIFER no iniciará en modo local para evitar crear una base de datos paralela. ' + (error && error.message ? error.message : String(error))); } }
    createWindow();
    if (app.isPackaged) {
      updateCheckTimer = setInterval(() => autoUpdater.checkForUpdates().catch(error => broadcastAppUpdate('error', { message: String(error && error.message || error).slice(0, 500) })), 6 * 60 * 60 * 1000);
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('No se pudo iniciar SIFER 360', error && error.message ? error.message : String(error));
    app.quit();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearTimeout(saveTimer); if (updateCheckTimer) clearInterval(updateCheckTimer); if (networkServer) networkServer.close(); stopDiscoveryServer(); persistDb(); });
