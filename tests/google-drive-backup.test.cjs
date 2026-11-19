'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptBackup, decryptBackup, createDailyTaskXml, buildAccountConfig, assertBackupAllowed, createGoogleDriveBackup } = require('../electron/google-drive-backup.cjs');
const initSqlJs = require('sql.js');
const { sqliteDatabaseToJson } = require('../electron/sqlite-json-export.cjs');

test('el respaldo cifrado AES-256-GCM conserva los bytes SQLite', () => {
  const key = crypto.randomBytes(32);
  const sqlite = Buffer.from('SQLite format 3\0fixture-data');
  const encrypted = encryptBackup(sqlite, key);
  assert.notDeepEqual(encrypted, sqlite);
  assert.equal(decryptBackup(encrypted, key).toString(), sqlite.toString());
});

test('el respaldo cifrado rechaza alteraciones o clave incorrecta', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptBackup(Buffer.from('datos sensibles'), key);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 0x01;
  assert.throws(() => decryptBackup(tampered, key));
  assert.throws(() => decryptBackup(encrypted, crypto.randomBytes(32)));
});

test('el archivo de tarea programa diariamente a las 20:00 UTC-04:00', () => {
  const xml = createDailyTaskXml('C:\\Program Files\\SIFER360\\SIFER.exe', '--sifer-google-drive-backup', new Date('2026-11-16T15:00:00Z'));
  assert.match(xml, /T20:00:00-04:00/);
  assert.ok(xml.includes('<DaysInterval>1</DaysInterval>'));
  assert.ok(xml.includes('<StartWhenAvailable>true</StartWhenAvailable>'));
  assert.match(xml, /--sifer-google-drive-backup/);
  assert.match(xml, /InteractiveToken/);
});

test('el formato de archivo cifrado tiene cabecera versionada', () => {
  const encrypted = encryptBackup(Buffer.from('x'), crypto.randomBytes(32));
  assert.equal(encrypted.subarray(0, 12).toString(), 'SIFER360GDR1');
});

test('la exportación JSON contiene todas las tablas y supera integrity_check', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE app_state(id INTEGER PRIMARY KEY, payload TEXT)');
  db.run('CREATE INDEX idx_app_state_payload ON app_state(payload)');
  db.run('CREATE TABLE binary_data(id INTEGER PRIMARY KEY, contents BLOB)');
  db.run('INSERT INTO app_state(id,payload) VALUES(1,?)', ['{"sales":[1,2]}']);
  db.run('INSERT INTO binary_data(id,contents) VALUES(1,?)', [new Uint8Array([0,1,2])]);
  const json = JSON.parse(sqliteDatabaseToJson(db, '2026-11-16T20:00:00-04:00').toString('utf8'));
  assert.equal(json.format, 'SIFER360_SQLITE_JSON_BACKUP_V1');
  assert.equal(json.databaseIntegrity, 'ok');
  assert.deepEqual(json.tables.app_state.rows[0], [1, '{"sales":[1,2]}']);
  assert.deepEqual(json.tables.binary_data.rows[0][1], { type:'base64', value:'AAEC' });
  assert.ok(json.schema.some(item => item.type === 'table' && item.name === 'app_state' && item.sql.includes('CREATE TABLE')));
  assert.ok(json.schema.some(item => item.type === 'index' && item.name === 'idx_app_state_payload'));
  db.close();
});

test('la exportación JSON rechaza una base inválida', () => {
  assert.throws(() => sqliteDatabaseToJson(null), /base SQLite válida/);
});


test('cambiar la cuenta Drive conserva programación y clave, pero aísla la carpeta de la cuenta nueva', () => {
  const previous = {
    email: 'anterior@gmail.com',
    encryptedRefreshToken: 'token-anterior',
    encryptedBackupKey: 'clave-local-cifrada',
    recoveryKeyExported: true,
    enabled: true,
    schedule: { taskName: 'SIFER360 Google Drive Backup' },
    folderId: 'folder-antigua',
    lastBackupAt: '2026-11-15T20:00:00.000Z'
  };
  const next = buildAccountConfig(previous, 'nueva@gmail.com', 'token-nuevo', 'folder-nueva');
  assert.equal(next.email, 'nueva@gmail.com');
  assert.equal(next.encryptedRefreshToken, 'token-nuevo');
  assert.equal(next.folderId, 'folder-nueva');
  assert.equal(next.enabled, true);
  assert.deepEqual(next.schedule, previous.schedule);
  assert.equal(next.encryptedBackupKey, previous.encryptedBackupKey);
  assert.equal(next.recoveryKeyExported, true);
  assert.equal(next.lastBackupAt, previous.lastBackupAt);
  assert.equal(previous.email, 'anterior@gmail.com');
  assert.equal(previous.folderId, 'folder-antigua');
});

test('cambiar de cuenta conserva programación desactivada', () => {
  const next = buildAccountConfig({ enabled: false, schedule: null, folderId: 'old' }, 'nueva@gmail.com', 'token', 'new');
  assert.equal(next.enabled, false);
  assert.equal(next.schedule, null);
});
test('el respaldo manual funciona aunque la programación diaria esté desactivada', () => {
  assert.equal(assertBackupAllowed({ enabled: false, encryptedRefreshToken: 'token-cifrado' }, true), true);
});

test('el respaldo programado exige activación diaria y cuenta conectada', () => {
  assert.throws(() => assertBackupAllowed({ enabled: false, encryptedRefreshToken: 'token-cifrado' }, false), /no está activado/);
  assert.throws(() => assertBackupAllowed({ enabled: true, encryptedRefreshToken: '' }, false), /no está activado/);
});

test('el respaldo manual también exige una cuenta Google conectada', () => {
  assert.throws(() => assertBackupAllowed({ enabled: false, encryptedRefreshToken: '' }, true), /Conecta primero/);
});

test('lista y descarga copias SQLite de Drive, valida carpeta y descifra antes de entregar el archivo', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer360-drive-'));
  try {
    const key = Buffer.alloc(32, 7);
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value), 'utf8'),
      decryptString: value => Buffer.from(value).toString('utf8')
    };
    const protect = value => safeStorage.encryptString(value).toString('base64');
    fs.mkdirSync(path.join(directory, 'google-drive-backup'), { recursive:true });
    fs.writeFileSync(path.join(directory, 'google-drive-backup', 'config.json'), JSON.stringify({
      enabled:false,
      email:'admin@example.com',
      folderId:'folder_123',
      encryptedRefreshToken:protect('refresh-token'),
      encryptedBackupKey:protect(key.toString('base64'))
    }));
    const plain = Buffer.concat([Buffer.from('SQLite format 3\\0','binary'), Buffer.from('test-database')]);
    const encrypted = encryptBackup(plain, key);
    const requestJson = async url => {
      if (String(url).includes('oauth2.googleapis.com')) return { body:{ access_token:'access-token' } };
      if (String(url).includes('/files/file_123')) return { body:{ id:'file_123', name:'SIFER360-2026-11-19.sqlite.siferenc', parents:['folder_123'], mimeType:'application/octet-stream', modifiedTime:'2026-11-19T20:00:00Z' } };
      return { body:{ files:[{ id:'file_123', name:'SIFER360-2026-11-19.sqlite.siferenc', size:'128', modifiedTime:'2026-11-19T20:00:00Z' }] } };
    };
    const backup = createGoogleDriveBackup({
      app:{ getPath:() => directory },
      safeStorage,
      clientId:'test.apps.googleusercontent.com',
      requestJson,
      requestBuffer:async () => ({ bytes:encrypted }),
      scheduler:{ configure:() => ({}), remove:() => ({}) }
    });
    const files = await backup.listBackups();
    assert.equal(files.length, 1);
    assert.equal(files[0].id, 'file_123');
    const downloaded = await backup.downloadBackup('file_123');
    assert.equal(downloaded.name, 'SIFER360-2026-11-19.sqlite');
    assert.deepEqual(downloaded.bytes, plain);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('importa una clave de recuperación externa y la protege en el almacén local', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer360-key-import-'));
  try {
    const key = Buffer.alloc(32, 9);
    const keyFile = path.join(directory, 'recovery.txt');
    fs.writeFileSync(keyFile, 'SIFER360-LICORERIA - CLAVE DE RECUPERACIÓN DE RESPALDOS\nGuarde este archivo fuera del equipo.\n\n' + key.toString('base64') + '\n');
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value), 'utf8'),
      decryptString: value => Buffer.from(value).toString('utf8')
    };
    const backup = createGoogleDriveBackup({
      app:{ getPath:() => directory },
      safeStorage,
      dialog:{ showOpenDialog:async () => ({ canceled:false, filePaths:[keyFile] }) },
      scheduler:{ configure:() => ({}), remove:() => ({}) }
    });
    const result = await backup.importRecoveryKey();
    assert.equal(result.imported, true);
    assert.deepEqual(backup.getBackupKey(backup.readConfig()), key);
    assert.equal(backup.readConfig().recoveryKeyExported, true);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
