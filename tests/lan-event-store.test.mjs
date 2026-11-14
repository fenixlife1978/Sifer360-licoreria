import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const { applyIncomingEvents } = require('../electron/lan-event-store.cjs');
const SQL = await initSqlJs();

function fixture({ failPersist = false } = {}) {
  let db = new SQL.Database();
  db.run(`
    CREATE TABLE app_state(id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE network_received_operations(
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(device_id, device_seq)
    );
  `);
  db.run('INSERT INTO app_state(id,payload) VALUES(1,?)', [JSON.stringify({ sales: [], purchases: [] })]);
  let persistedSnapshot = Buffer.from(db.export());
  let persistCalls = 0;

  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.run(params); } finally { statement.free(); }
  };
  const one = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); return statement.step() ? statement.getAsObject() : null; }
    finally { statement.free(); }
  };
  const context = () => ({
    db,
    persist: () => {
      persistCalls++;
      if (failPersist) throw new Error('simulated SQLite disk failure');
      const integrity = db.exec('PRAGMA integrity_check');
      if (integrity[0].values[0][0] !== 'ok') throw new Error('integrity_check failed');
      persistedSnapshot = Buffer.from(db.export());
    },
    restore: snapshot => {
      try { db.close(); } catch {}
      db = new SQL.Database(snapshot);
    },
    statePayloadHash: payload => require('node:crypto').createHash('sha256').update(String(payload || '')).digest('hex')
  });
  return {
    apply: events => applyIncomingEvents({ ...context(), events }),
    state: () => JSON.parse(one('SELECT payload FROM app_state WHERE id=1').payload),
    received: () => one('SELECT COUNT(*) AS count FROM network_received_operations').count,
    event: id => one('SELECT * FROM network_received_operations WHERE event_id=?', [id]),
    integrity: () => db.exec('PRAGMA integrity_check')[0].values[0][0],
    persisted: () => Buffer.from(persistedSnapshot),
    persistCalls: () => persistCalls
  };
}

function event({
  eventId = 'event-1',
  deviceId = 'device-a',
  deviceSeq = 1,
  entityId = 'SALE-0001',
  cashbox = '01',
  total = 10,
  entityType = 'sales'
} = {}) {
  return {
    eventId, deviceId, deviceSeq, eventType: 'sale', entityType, entityId,
    occurredAt: '2026-11-14T12:00:00.000Z',
    payload: { record: { id: entityId, cashbox, total } }
  };
}

test('acepta una venta, la persiste en SQLite y un reintento idéntico devuelve duplicate sin duplicar el registro', () => {
  const db = fixture();
  const first = db.apply([event()]);
  assert.deepEqual(first.accepted, ['event-1']);
  assert.deepEqual(first.duplicates, []);
  assert.equal(db.state().sales.length, 1);
  assert.equal(db.received(), 1);

  const retry = db.apply([event()]);
  assert.deepEqual(retry.accepted, []);
  assert.deepEqual(retry.duplicates, ['event-1']);
  assert.equal(db.state().sales.length, 1);
  assert.equal(db.received(), 1);
  assert.equal(db.integrity(), 'ok');
});

test('reutilizar eventId con contenido distinto produce conflicto y no modifica SQLite', () => {
  const db = fixture();
  db.apply([event()]);
  const result = db.apply([event({ total: 999 })]);
  assert.equal(result.conflicts[0].reason, 'event-id-reused-with-different-data');
  assert.deepEqual(result.accepted, []);
  assert.equal(db.state().sales[0].total, 10);
  assert.equal(db.received(), 1);
});

test('reutilizar una secuencia del mismo dispositivo con otro eventId produce conflicto', () => {
  const db = fixture();
  db.apply([event()]);
  const result = db.apply([event({ eventId: 'event-2', entityId: 'SALE-0002' })]);
  assert.equal(result.conflicts[0].reason, 'device-sequence-already-used');
  assert.equal(db.state().sales.length, 1);
  assert.equal(db.received(), 1);
});

test('una entidad ya existente con datos diferentes se rechaza antes de registrar el evento recibido', () => {
  const db = fixture();
  db.apply([event()]);
  const result = db.apply([event({ eventId: 'event-2', deviceSeq: 2, total: 99 })]);
  assert.equal(result.conflicts[0].reason, 'entity-already-exists-with-different-data');
  assert.equal(db.received(), 1);
  assert.equal(db.state().sales[0].total, 10);
});

test('dos cajas pueden tener el mismo identificador de venta sin colisionar', () => {
  const db = fixture();
  const result = db.apply([
    event({ eventId: 'event-box-1', deviceSeq: 1, cashbox: '01' }),
    event({ eventId: 'event-box-2', deviceSeq: 2, cashbox: '02' })
  ]);
  assert.deepEqual(result.accepted, ['event-box-1', 'event-box-2']);
  assert.equal(db.state().sales.length, 2);
  assert.deepEqual(db.state().sales.map(item => item.cashbox).sort(), ['01', '02']);
  assert.equal(db.received(), 2);
});

test('dos dispositivos distintos pueden usar el mismo consecutivo local', () => {
  const db = fixture();
  const result = db.apply([
    event({ eventId: 'event-device-a', deviceId: 'device-a', deviceSeq: 1 }),
    event({ eventId: 'event-device-b', deviceId: 'device-b', deviceSeq: 1, entityId: 'SALE-0002' })
  ]);
  assert.deepEqual(result.accepted, ['event-device-a', 'event-device-b']);
  assert.equal(db.received(), 2);
});

test('una colección no permitida rechaza todo el lote y revierte la transacción', () => {
  const db = fixture();
  assert.throws(() => db.apply([
    event({ eventId: 'event-valid', deviceSeq: 1 }),
    event({ eventId: 'event-invalid', deviceSeq: 2, entityType: 'auth_users' })
  ]), /entidad permitida/);
  assert.equal(db.received(), 0);
  assert.equal(db.state().sales.length, 0);
  assert.equal(db.integrity(), 'ok');
});

test('un fallo al persistir restaura exactamente el snapshot SQLite anterior', () => {
  const db = fixture({ failPersist: true });
  const before = db.persisted();
  assert.throws(() => db.apply([event()]), /restauró el estado anterior y rechazó el lote/);
  assert.deepEqual(db.persisted(), before);
  assert.equal(db.state().sales.length, 0);
  assert.equal(db.received(), 0);
  assert.equal(db.integrity(), 'ok');
  assert.equal(db.persistCalls(), 1);
});

test('el evento debe tener una secuencia entera segura y positiva', () => {
  const db = fixture();
  assert.throws(() => db.apply([event({ deviceSeq: Number.MAX_SAFE_INTEGER + 1 })]), /Operación inválida/);
  assert.throws(() => db.apply([event({ eventId: 'event-zero', deviceSeq: 0 })]), /Operación inválida/);
  assert.equal(db.received(), 0);
});

test('el identificador declarado debe coincidir con el identificador real del registro', () => {
  const db = fixture();
  const invalid = event();
  invalid.payload.record.id = 'SALE-OTHER';
  assert.throws(() => db.apply([invalid]), /no coincide con el identificador del registro/);
  assert.equal(db.received(), 0);
  assert.equal(db.state().sales.length, 0);
});

test('el receptor limita el tamaño de los identificadores y metadatos de evento', () => {
  const db = fixture();
  assert.throws(() => db.apply([event({ eventId: 'x'.repeat(257) })]), /Operación inválida/);
  assert.throws(() => db.apply([event({ entityId: 'x'.repeat(257) })]), /Operación inválida/);
  assert.equal(db.received(), 0);
});

test('acepta y persiste eventos de movimientos de caja, auditoría de tasa y lotes bancarios', () => {
  const db = fixture();
  const events = [
    { eventId:'cash-movement-1', deviceId:'device-a', deviceSeq:1, eventType:'cashbox-movement', entityType:'movimientosCaja', entityId:'MOV-01-000001', occurredAt:'2026-11-14T12:00:00.000Z', payload:{record:{id:'MOV-01-000001',cashbox:'01',sequence:1,amount:25}} },
    { eventId:'rate-audit-1', deviceId:'device-a', deviceSeq:2, eventType:'exchange-rate-audit', entityType:'rateAudit', entityId:'BCV-100-0001', occurredAt:'2026-11-14T12:00:01.000Z', payload:{record:{id:'BCV-100-0001',cashbox:'01',newRate:900}} },
    { eventId:'bank-batch-1', deviceId:'device-a', deviceSeq:3, eventType:'bank-batch', entityType:'lotesSudeban', entityId:'LOT-000144', occurredAt:'2026-11-14T12:00:02.000Z', payload:{record:{id:'LOT-000144',refLote:'ABC',totalBs:500}} }
  ];
  const result = db.apply(events);
  assert.equal(result.accepted.length, 3);
  assert.equal(db.state().movimientosCaja[0].amount, 25);
  assert.equal(db.state().rateAudit[0].newRate, 900);
  assert.equal(db.state().lotesSudeban[0].refLote, 'ABC');
  assert.equal(db.integrity(), 'ok');
});

test('Kardex de dispositivos distintos no colisiona aunque su contador numérico local sea igual', () => {
  const db = fixture();
  const first = { id: 1, eventId: 'kdx-device-a-1', code: 'ART-01', cashbox: '01', ts: 100, qty: 1 };
  const second = { id: 1, eventId: 'kdx-device-b-1', code: 'ART-02', cashbox: '01', ts: 101, qty: 2 };
  const result = db.apply([
    { eventId: 'evt-kdx-a', deviceId: 'device-a', deviceSeq: 1, eventType: 'inventory-movement', entityType: 'kardex', entityId: first.eventId, occurredAt: new Date(100).toISOString(), payload: { record: first } },
    { eventId: 'evt-kdx-b', deviceId: 'device-b', deviceSeq: 1, eventType: 'inventory-movement', entityType: 'kardex', entityId: second.eventId, occurredAt: new Date(101).toISOString(), payload: { record: second } }
  ]);
  assert.deepEqual(result.accepted, ['evt-kdx-a', 'evt-kdx-b']);
  assert.equal(db.state().kardex.length, 2);
  assert.deepEqual(db.state().kardex.map(x => x.eventId).sort(), ['kdx-device-a-1', 'kdx-device-b-1']);
});
