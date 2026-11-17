'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacyBackupTaskRetirer, TASK_NAME } = require('../electron/legacy-backup-task.cjs');

test('en equipos que no usan Windows no intenta retirar tareas programadas', () => {
  let called = false;
  const retirer = createLegacyBackupTaskRetirer({
    platform: 'linux',
    execFile: () => { called = true; }
  });
  assert.deepEqual(retirer.remove(), { scheduled: false });
  assert.equal(called, false);
});

test('retira la tarea heredada de Google Drive sin ejecutar respaldos ni abrir conexiones', () => {
  let call;
  const retirer = createLegacyBackupTaskRetirer({
    platform: 'win32',
    execFile: (...args) => { call = args; }
  });
  assert.deepEqual(retirer.remove(), { scheduled: false });
  assert.equal(call[0], 'schtasks.exe');
  assert.deepEqual(call[1], ['/Delete', '/TN', TASK_NAME, '/F']);
});

test('ignora que la tarea heredada ya no exista', () => {
  const retirer = createLegacyBackupTaskRetirer({
    platform: 'win32',
    execFile: () => { throw new Error('ERROR: The system cannot find the file specified'); }
  });
  assert.deepEqual(retirer.remove(), { scheduled: false });
});

test('ignora que la tarea heredada no exista en Windows en español', () => {
  const retirer = createLegacyBackupTaskRetirer({
    platform: 'win32',
    execFile: () => { throw new Error('ERROR: El sistema no puede encontrar el archivo especificado'); }
  });
  assert.deepEqual(retirer.remove(), { scheduled: false });
});

test('propaga errores reales al retirar la tarea para que queden registrados', () => {
  const retirer = createLegacyBackupTaskRetirer({
    platform: 'win32',
    execFile: () => { throw new Error('Access is denied'); }
  });
  assert.throws(() => retirer.remove(), /Access is denied/);
});
