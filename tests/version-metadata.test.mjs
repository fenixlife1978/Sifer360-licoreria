import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('v1.1.3 package, instalador y artefactos Windows usan una versión coherente', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const builder = JSON.parse(await read('../electron-builder.json'));
  const [buildExe, desktop, validation, releaseNotes] = await Promise.all([
    read('../.github/workflows/build-exe.yml'),
    read('../.github/workflows/desktop-verification.yml'),
    read('../.github/workflows/sifer360-104-google-drive-validation.yml'),
    read('../RELEASE_NOTES_1.1.3.md')
  ]);

  assert.equal(pkg.version, '1.1.3');
  assert.equal(builder.portable.artifactName, 'SIFER360-1.1.3-Portable.exe');
  assert.equal(builder.nsis.artifactName, 'SIFER360-1.1.3-Instalador.exe');
  assert.match(buildExe, /SIFER360-1\.1\.3-Windows-Installer-and-Portable/);
  assert.match(desktop, /SIFER360-1\.1\.3-Windows-Desktop/);
  assert.match(validation, /SIFER360-1\.1\.3-Desktop-SQLite-Windows/);
  for (const workflow of [buildExe, desktop, validation]) assert.match(workflow, /SIFER360_GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(releaseNotes, /1\.1\.3/);
});

test('v1.1.3 conserva SQLite como autoridad y permite solo respaldos cifrados opcionales', async () => {
  const main = await read('../electron/main.cjs');
  const preload = await read('../electron/preload.cjs');
  const renderer = await read('../public/main.js');
  const backup = await read('../electron/google-drive-backup.cjs');
  const jsonExport = await read('../electron/sqlite-json-export.cjs');

  assert.match(main, /createGoogleDriveBackup/);
  assert.match(main, /backup:run-now/);
  assert.match(main, /backup:list-files/);
  assert.match(main, /backup:download-file/);
  assert.match(main, /requireAuthSession\(token, true\)/);
  assert.match(main, /networkConfig\.role === 'client'/);
  assert.match(preload, /backupConnectGoogle/);
  assert.match(preload, /backupDownloadFile/);
  assert.match(preload, /backupSaveBeforeRestore/);
  assert.match(renderer, /Respaldo cifrado automático en Google Drive/);
  assert.match(renderer, /Descargar y descifrar/);
  assert.match(renderer, /window\.confirm/);
  assert.match(backup, /AES-256-GCM/);
  assert.match(backup, /code_verifier/);
  assert.match(jsonExport, /sqlite_master/);
});
