import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const builder=JSON.parse(readFileSync(new URL('../electron-builder.json',import.meta.url),'utf8'));
const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
const preload=readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
const renderer=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');

test('desktop updater is configured for official GitHub Releases and metadata feed',()=>{
 assert.ok(pkg.dependencies['electron-updater']);
 assert.equal(builder.publish[0].provider,'github');
 assert.equal(builder.publish[0].owner,'fenixlife1978');
 assert.equal(builder.publish[0].repo,'Sifer360-licoreria');
 assert.match(builder.publish[0].releaseType,/release/);
});

test('updater downloads in background and checks on startup plus six-hour interval',()=>{
 assert.match(main,/autoUpdater\.autoDownload\s*=\s*true/);
 assert.match(main,/update-downloaded/);
 assert.match(main,/6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
 assert.match(main,/autoUpdater\.checkForUpdates\(\)/);
});

test('installation requires a completed download and verifies/persists server SQLite',()=>{
 assert.match(main,/if\s*\(!updateDownloaded\)/);
 assert.match(main,/databaseIntegrityStatus\(db\)/);
 assert.match(main,/persistDb\(\)/);
 assert.match(main,/quitAndInstall\(false,\s*true\)/);
 assert.match(preload,/appUpdateInstall/);
 assert.match(renderer,/Instalar ahora/);
 assert.match(renderer,/Más tarde/);
 assert.match(renderer,/sifer-update-banner/);
 assert.match(renderer,/fiscalPrinterJobs/);
});

test('application data remains in Electron userData outside packaged app files',()=>{
 assert.match(main,/app\.getPath\('userData'\)/);
 assert.match(main,/sifer360-licoreria\.sqlite/);
 assert.doesNotMatch(builder.files.join(' '),/userData|sifer360-licoreria\.sqlite/);
});
