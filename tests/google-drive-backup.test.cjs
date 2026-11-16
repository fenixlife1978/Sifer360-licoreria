'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encryptBackup, decryptBackup, createDailyTaskXml } = require('../electron/google-drive-backup.cjs');

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
  assert.match(xml, /<DaysInterval>1<\\/DaysInterval>/);
  assert.match(xml, /<StartWhenAvailable>true<\\/StartWhenAvailable>/);
  assert.match(xml, /--sifer-google-drive-backup/);
  assert.match(xml, /InteractiveToken/);
});

test('el formato de archivo cifrado tiene cabecera versionada', () => {
  const encrypted = encryptBackup(Buffer.from('x'), crypto.randomBytes(32));
  assert.equal(encrypted.subarray(0, 12).toString(), 'SIFER360GDR1');
});
