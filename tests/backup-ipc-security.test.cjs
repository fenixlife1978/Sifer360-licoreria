'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const access = fs.readFileSync(path.join(root, 'public/access.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/main.js'), 'utf8');

test('todas las operaciones de respaldo exigen una sesión SQLite de administrador', () => {
  const handlers = [
    ['backup:status', /backup:status',[\s\S]{0,300}requireAuthSession\(token, true\)/],
    ['backup:connect-google', /backup:connect-google',[\s\S]{0,180}requireAuthSession\(token, true\)/],
    ['backup:enable-daily', /backup:enable-daily',[\s\S]{0,160}requireAuthSession\(token, true\)/],
    ['backup:disable-daily', /backup:disable-daily',[\s\S]{0,130}requireAuthSession\(token, true\)/],
    ['backup:run-now', /backup:run-now',[\s\S]{0,160}requireAuthSession\(token, true\)/],
    ['backup:export-recovery-key', /backup:export-recovery-key',[\s\S]{0,130}requireAuthSession\(token, true\)/],
    ['backup:list-files', /backup:list-files',[\s\S]{0,160}requireAuthSession\(token, true\)/],
    ['backup:download-file', /backup:download-file',[\s\S]{0,220}requireAuthSession\(token, true\)/],
    ['backup:save-before-restore', /backup:save-before-restore',[\s\S]{0,180}requireAuthSession\(token, true\)/]
  ];
  for (const [name, pattern] of handlers) assert.match(main, pattern, name + ' debe requerir sesión admin');
});

test('preload transmite el token a todos los métodos de respaldo', () => {
  for (const method of ['backupStatus', 'backupEnableDaily', 'backupDisableDaily', 'backupRunNow', 'backupExportRecoveryKey', 'backupListFiles', 'backupSaveBeforeRestore']) {
    assert.match(preload, new RegExp(method + ':\\s*token'));
  }
  assert.match(preload, /backupConnectGoogle: \(token, email\)/);
  assert.match(preload, /backupDownloadFile: \(token, fileId\)/);
  assert.match(preload, /backupSaveBeforeRestore: token/);
});

test('el inicio de sesión de escritorio autentica contra SQLite y restaura sesiones vigentes', () => {
  assert.match(access, /authInitializeLegacyUsers\(payload\)/);
  assert.match(access, /authLogin\(\{username,password:code\}\)/);
  assert.match(access, /authVerifySession\(saved\.authToken\)/);
  assert.match(access, /authToken:serverAuth&&serverAuth\.token/);
});

test('la gestión de usuarios persiste cambios y bajas en SQLite', () => {
  assert.match(ui, /authSaveUser\(authSession\.authToken,\{username,name,role,cashbox,password:code\}\)/);
  assert.match(ui, /authDeleteUser\(authSession\.authToken,u\)/);
});

test('la tarea programada no se pierde si llega mientras Electron inicializa SQLite', () => {
  assert.match(main, /pendingScheduledBackup = true/);
  assert.match(main, /if \(pendingScheduledBackup\)/);
  assert.match(main, /runScheduledGoogleDriveBackup\(\)/);
});

test('la restauración desde una copia descargada requiere confirmación y guarda primero la SQLite actual', () => {
  assert.match(ui, /window\.confirm\('Vas a reemplazar la base SQLite activa/);
  assert.match(ui, /backupSaveBeforeRestore\(authToken\(\)\)/);
  assert.match(main, /SIFER360-pre-restauracion-/);
  assert.match(ui, /backupDownloadFile\(authToken\(\), fileId\)/);
});
