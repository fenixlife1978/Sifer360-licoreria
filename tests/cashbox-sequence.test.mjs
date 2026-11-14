import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const { allocateCashboxSequence } = require('../electron/cashbox-sequence.cjs');
const SQL = await initSqlJs();

function fixture({ failPersist = false } = {}) {
  let db = new SQL.Database();
  db.run(`
    CREATE TABLE cashbox_sequences(
      cashbox_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(cashbox_id, operation_type)
    );
  `);
  let persisted = Buffer.from(db.export());
  const allocate = (cashboxId, operationType, minimumValue = 1) => allocateCashboxSequence({
    db, cashboxId, operationType, minimumValue,
    persist: () => {
      if (failPersist) throw new Error('simulated disk failure');
      const result = db.exec('PRAGMA integrity_check');
      if (result[0].values[0][0] !== 'ok') throw new Error('integrity failure');
      persisted = Buffer.from(db.export());
    },
    restore: snapshot => {
      try { db.close(); } catch {}
      db = new SQL.Database(snapshot);
    }
  });
  const rows = () => {
    const stmt = db.prepare('SELECT cashbox_id,operation_type,last_value FROM cashbox_sequences ORDER BY cashbox_id,operation_type');
    const result = [];
    try { while (stmt.step()) result.push(stmt.getAsObject()); } finally { stmt.free(); }
    return result;
  };
  return { allocate, rows, persisted: () => Buffer.from(persisted), database: () => db };
}

test('cada caja mantiene su propio consecutivo para la misma operación', () => {
  const f = fixture();
  assert.equal(f.allocate('01', 'invoice').value, 1);
  assert.equal(f.allocate('01', 'invoice').value, 2);
  assert.equal(f.allocate('02', 'invoice').value, 1);
  assert.equal(f.allocate('02', 'invoice').value, 2);
  assert.equal(f.allocate('01', 'invoice').value, 3);
});

test('cada tipo de operación tiene secuencia independiente dentro de una caja', () => {
  const f = fixture();
  assert.equal(f.allocate('01', 'invoice').value, 1);
  assert.equal(f.allocate('01', 'z').value, 1);
  assert.equal(f.allocate('01', 'refund').value, 1);
  assert.equal(f.allocate('01', 'invoice').value, 2);
});

test('respeta un mínimo solicitado y continúa desde el valor persistido', () => {
  const f = fixture();
  assert.equal(f.allocate('01', 'invoice', 500).value, 500);
  assert.equal(f.allocate('01', 'invoice').value, 501);
});

test('los consecutivos sobreviven a reiniciar el proceso con la misma base SQLite', () => {
  const f = fixture();
  f.allocate('01', 'z');
  f.allocate('01', 'z');
  const restartedDb = new SQL.Database(new Uint8Array(f.persisted()));
  const next = allocateCashboxSequence({
    db: restartedDb,
    cashboxId: '01',
    operationType: 'z',
    persist: () => {},
    restore: () => {}
  });
  assert.equal(next.value, 3);
});

test('múltiples solicitudes simultáneas del mismo servidor reciben números únicos y ordenados', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 50 }, () => Promise.resolve().then(() => f.allocate('01', 'invoice').value)));
  assert.deepEqual(results.sort((a,b) => a-b), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(f.rows()[0].last_value, 50);
});

test('permite tipos de retención por período y rechaza cajas o tipos inválidos', () => {
  const f = fixture();
  assert.equal(f.allocate('01', 'retention-202611').value, 1);
  assert.throws(() => f.allocate('../01', 'invoice'), /Caja inválida/);
  assert.throws(() => f.allocate('01', 'arbitrary-operation'), /Tipo de operación no permitido/);
});

test('un fallo de persistencia restaura el snapshot y no consume el consecutivo', () => {
  const f = fixture({ failPersist: true });
  const before = f.persisted();
  assert.throws(() => f.allocate('01', 'invoice'), /No se confirmó el consecutivo en disco/);
  assert.deepEqual(f.persisted(), before);
  assert.deepEqual(f.rows(), []);
});
