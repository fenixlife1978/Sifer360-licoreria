import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('v1.0.8 package and Windows artifacts use one consistent version', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const builder = JSON.parse(await read('../electron-builder.json'));
  const [buildExe, desktop, validation] = await Promise.all([
    read('../.github/workflows/build-exe.yml'),
    read('../.github/workflows/desktop-verification.yml'),
    read('../.github/workflows/sifer360-104-google-drive-validation.yml')
  ]);

  assert.equal(pkg.version, '1.0.8');
  assert.equal(builder.portable.artifactName, 'SIFER360-1.0.8-Portable.exe');
  assert.equal(builder.nsis.artifactName, 'SIFER360-1.0.8-Instalador.exe');
  assert.match(buildExe, /SIFER360-1\.0\.8-Windows-Installer-and-Portable/);
  assert.match(desktop, /SIFER360-1\.0\.8-Windows-Desktop/);
  assert.match(validation, /SIFER360-1\.0\.8-Desktop-SQLite-Windows/);
  assert.doesNotMatch(buildExe, /SIFER360-1\.0\.[467]-/);
  assert.doesNotMatch(desktop, /SIFER360-1\.0\.[467]-/);
  assert.doesNotMatch(validation, /SIFER360-1\.0\.[467]-/);
  for (const workflow of [buildExe, desktop, validation]) assert.doesNotMatch(workflow, /GOOGLE_OAUTH|google-drive-oauth|google-drive-backup\\.cjs|sqlite-json-export\\.cjs/);
});

test('v1.0.8 remains local-only and cannot upload SQLite to cloud backup services', async () => {
  const main = await read('../electron/main.cjs');
  const preload = await read('../electron/preload.cjs');
  const renderer = await read('../public/main.js');
  const workflow = await read('../.github/workflows/sifer360-104-google-drive-validation.yml');
  assert.match(main, /legacyBackupTaskRetirer\.remove\(\)/);
  assert.doesNotMatch(main, /createGoogleDriveBackup|createWindowsBackupScheduler|backup:run-now|backup:connect-google|sqliteDatabaseToJson|google-drive-backup\.cjs/);
  assert.doesNotMatch(preload, /backupStatus|backupConnectGoogle|backupRunNow|backupEnableDaily/);
  assert.doesNotMatch(renderer, /Google Drive|gdrive|backupRunNow/);
});
