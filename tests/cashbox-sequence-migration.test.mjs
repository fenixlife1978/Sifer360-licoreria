import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const { migrateCashboxSequenceCategories } = require('../electron/cashbox-sequence-migration.cjs');
const SQL = await initSqlJs();

function fixture({ state = {}, failPersist = false } = {}) {
  let db = new SQL.Database();
  db.run(`
    CREATE TABLE cashbox_sequences(
      cashbox_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(cashbox_id, operation_type)
    );
    CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  let persistCount = 0;
  const run = (sql, params = []) => {
    const stmt = db.prepare(sql);
    try { stmt.run(params); } finally { stmt.free(); }
  };
  const one = (sql, params = []) => {
    const stmt = db.prepare(sql);
    try { stmt.bind(params); return stmt.step() ? stmt.getAsObject() : null; } finally { stmt.free(); }
  };
  const migrate = () => migrateCashboxSequenceCategories({
    db, state,
    persist: () => {
      persistCount++;
      if (failPersist) throw new Error('simulated migration persistence failure');
      assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    },
    restore: snapshot => { try { db.close(); } catch {} db = new SQL.Database(snapshot); }
  });
  const set = (cashbox, operation, value) => run('INSERT INTO cashbox_sequences(cashbox_id,operation_type,last_value) VALUES(?,?,?)', [cashbox, operation, value]);
  const get = (cashbox, operation) => {
    const row = one('SELECT last_value FROM cashbox_sequences WHERE cashbox_id=? AND operation_type=?', [cashbox, operation]);
    return row ? Number(row.last_value) : null;
  };
  return { migrate, set, get, db: () => db, persistCount: () => persistCount, marker: () => one('SELECT migration_key FROM schema_migrations WHERE migration_key=?', ['cashbox-operation-sequences-v1']) };
}

test('separa el contador histórico compartido usando los máximos reales de cada tipo y caja', () => {
  const state = {
    movimientosCaja: [{ cashbox: '01', sequence: 3 }, { cashbox: '02', sequence: 4 }],
    cambiosDivisas: [{ cashbox: '01', sequence: 7 }],
    cxc: [{ cashbox: '01', payments: [{ cashbox: '01', cashboxSequence: 9 }, { cashbox: '02', cashboxSequence: 2 }] }],
    cxp: [{ cashbox: '01', payments: [{ cashbox: '01', cashboxSequence: 5 }] }]
  };
  const f = fixture({ state });
  f.set('01', 'movement', 30);
  f.set('02', 'movement', 20);
  assert.equal(f.migrate(), true);
  assert.equal(f.get('01', 'movement'), 3);
  assert.equal(f.get('02', 'movement'), 4);
  assert.equal(f.get('01', 'currency-exchange'), 7);
  assert.equal(f.get('01', 'cxc-payment'), 9);
  assert.equal(f.get('02', 'cxc-payment'), 2);
  assert.equal(f.get('01', 'cxp-payment'), 5);
  assert.equal(f.get('02', 'currency-exchange'), 0);
  assert.ok(f.marker());
});

test('la migración preserva un contador nuevo que ya supera los registros históricos', () => {
  const f = fixture({ state: { cxc: [{ cashbox: '01', payments: [{ cashboxSequence: 5 }] }] } });
  f.set('01', 'cxc-payment', 12);
  f.set('01', 'movement', 8);
  assert.equal(f.migrate(), true);
  assert.equal(f.get('01', 'cxc-payment'), 12);
  assert.equal(f.get('01', 'movement'), 0);
});

test('incluye cajas encontradas en registros aunque no tengan una fila movement antigua', () => {
  const f = fixture({ state: { cambiosDivisas: [{ cashbox: '03', sequence: 6 }] } });
  assert.equal(f.migrate(), true);
  assert.equal(f.get('03', 'currency-exchange'), 6);
  assert.equal(f.get('03', 'movement'), 0);
});

test('la migración es idempotente y no vuelve a alterar los consecutivos', () => {
  const f = fixture({ state: { movimientosCaja: [{ cashbox: '01', sequence: 4 }] } });
  f.set('01', 'movement', 20);
  assert.equal(f.migrate(), true);
  assert.equal(f.get('01', 'movement'), 4);
  assert.equal(f.migrate(), false);
  assert.equal(f.get('01', 'movement'), 4);
  assert.equal(f.persistCount(), 1);
});

test('un fallo de persistencia revierte la migración completa y no deja el marcador aplicado', () => {
  const f = fixture({ state: { movimientosCaja: [{ cashbox: '01', sequence: 4 }] }, failPersist: true });
  f.set('01', 'movement', 20);
  assert.throws(() => f.migrate(), /se restauró SQLite/);
  assert.equal(f.get('01', 'movement'), 20);
  assert.equal(f.get('01', 'currency-exchange'), null);
  assert.equal(f.marker(), null);
});

test('un consecutivo histórico inválido detiene la migración sin alterar la base', () => {
  const f = fixture({ state: { movimientosCaja: [{ cashbox: '01', sequence: 'not-a-number' }] } });
  f.set('01', 'movement', 7);
  assert.throws(() => f.migrate(), /consecutivo existente no es válido/);
  assert.equal(f.get('01', 'movement'), 7);
  assert.equal(f.marker(), null);
});
