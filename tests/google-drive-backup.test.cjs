'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encryptBackup, decryptBackup, createDailyTaskXml } = require('../electron/google-drive-backup.cjs');
const initSqlJs = require('sql.js');
const { sqliteDatabaseToJson } = require('../electron/sqlite-json-export.cjs');

test('el respaldo cifrado AES-256-GCM conserva los bytes SQLite', () => {
  const key = crypto.randomBytes(32);
  const sqlite = Buffer.from('SQLite format 3\\0fixture-data');
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
  db.run('INSERT INTO app_state(id,payload) VALUES(1,?)', ['{"sales":[1,2]}']);
  const json = JSON.parse(sqliteDatabaseToJson(db, '2026-11-16T20:00:00-04:00').toString('utf8'));
  assert.equal(json.format, 'SIFER360_SQLITE_JSON_BACKUP_V1');
  assert.equal(json.databaseIntegrity, 'ok');
  assert.deepEqual(json.tables.app_state.rows[0], [1, '{"sales":[1,2]}']);
  db.close();
});

test('la exportación JSON rechaza una base inválida', () => {
  assert.throws(() => sqliteDatabaseToJson(null), /base SQLite válida/);
});
