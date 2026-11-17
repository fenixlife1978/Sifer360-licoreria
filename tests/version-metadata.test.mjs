import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('v1.0.8 package and Windows artifacts use one consistent version', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const builder = JSON.parse(await read('../electron-builder.json'));
  const [buildExe, desktop, drive] = await Promise.all([
    read('../.github/workflows/build-exe.yml'),
    read('../.github/workflows/desktop-verification.yml'),
    read('../.github/workflows/sifer360-104-google-drive-validation.yml')
  ]);

  assert.equal(pkg.version, '1.0.8');
  assert.equal(builder.portable.artifactName, 'SIFER360-1.0.8-Portable.exe');
  assert.equal(builder.nsis.artifactName, 'SIFER360-1.0.8-Instalador.exe');
  assert.match(buildExe, /SIFER360-1\.0\.8-Windows-Installer-and-Portable/);
  assert.match(desktop, /SIFER360-1\.0\.8-Windows-Desktop/);
  assert.match(drive, /SIFER360-1\.0\.8-Desktop-SQLite-Windows/);
  assert.doesNotMatch(buildExe, /SIFER360-1\.0\.[467]-/);
  assert.doesNotMatch(desktop, /SIFER360-1\.0\.[467]-/);
  assert.doesNotMatch(drive, /SIFER360-1\.0\.[467]-/);
});
