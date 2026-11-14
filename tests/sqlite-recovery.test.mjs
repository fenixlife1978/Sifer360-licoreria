import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const { openOrRecoverDatabase } = require('../electron/sqlite-recovery.cjs');
const SQL = await initSqlJs();

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-sqlite-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sifer360.sqlite');
  const backup = file + '.bak';
  const createValid = value => {
    const db = new SQL.Database();
    db.run('CREATE TABLE proof(value TEXT NOT NULL)');
    db.run('INSERT INTO proof(value) VALUES(?)', [value]);
    const bytes = Buffer.from(db.export());
    db.close();
    return bytes;
  };
  const readValue = database => {
    const result = database.exec('SELECT value FROM proof');
    return result[0].values[0][0];
  };
  return { directory, file, backup, createValid, readValue };
}

test('abre la base principal íntegra sin sustituirla por el respaldo', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, f.createValid('primary'));
  fs.writeFileSync(f.backup, f.createValid('backup'));
  const opened = openOrRecoverDatabase({ SQL, file: f.file });
  assert.equal(opened.source, 'primary');
  assert.equal(opened.recovered, false);
  assert.equal(f.readValue(opened.database), 'primary');
});

test('restaura el respaldo cuando falta el archivo SQLite principal', t => {
  const f = fixture(t);
  fs.writeFileSync(f.backup, f.createValid('backup-data'));
  const opened = openOrRecoverDatabase({ SQL, file: f.file });
  assert.equal(opened.source, 'backup');
  assert.equal(opened.recovered, true);
  assert.equal(f.readValue(opened.database), 'backup-data');
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(f.readValue(new SQL.Database(new Uint8Array(fs.readFileSync(f.file)))), 'backup-data');
});

test('renombra la base principal corrupta y recupera la copia íntegra', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, Buffer.from('not-a-sqlite-database'));
  fs.writeFileSync(f.backup, f.createValid('recovered-data'));
  const opened = openOrRecoverDatabase({ SQL, file: f.file });
  assert.equal(opened.source, 'backup');
  assert.equal(opened.recovered, true);
  assert.equal(f.readValue(opened.database), 'recovered-data');
  assert.ok(opened.corruptFile);
  assert.equal(fs.existsSync(opened.corruptFile), true);
});

test('si falta la principal y el respaldo está dañado, no crea una base vacía', t => {
  const f = fixture(t);
  fs.writeFileSync(f.backup, Buffer.from('bad-backup'));
  assert.throws(() => openOrRecoverDatabase({ SQL, file: f.file }), /respaldo falló integrity_check|respaldo no se puede abrir/);
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(fs.existsSync(f.backup), true);
});

test('si no existe principal ni respaldo, crea una base nueva solo en una instalación realmente nueva', t => {
  const f = fixture(t);
  const opened = openOrRecoverDatabase({ SQL, file: f.file });
  assert.equal(opened.source, 'new');
  assert.equal(opened.recovered, false);
  assert.equal(opened.database.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
});

test('un fallo al escribir la recuperación conserva el respaldo y no finge recuperación', t => {
  const f = fixture(t);
  fs.writeFileSync(f.backup, f.createValid('backup-preserved'));
  const failingFs = {
    existsSync: fs.existsSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    openSync: () => { throw new Error('simulated recovery write failure'); },
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs)
  };
  assert.throws(() => openOrRecoverDatabase({ SQL, file: f.file, fsImpl: failingFs }), /No se pudo restaurar de forma durable/);
  assert.equal(fs.existsSync(f.backup), true);
  assert.equal(fs.existsSync(f.file), false);
});
