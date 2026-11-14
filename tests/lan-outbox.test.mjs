import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDurableOutbox } = require('../electron/lan-outbox.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-lan-outbox-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, deviceId: 'device-test-01' };
}

function operation(id, amount = 10) {
  return {
    eventId: id,
    eventType: 'sale',
    entityType: 'sales',
    entityId: 'SALE-0001',
    occurredAt: '2026-11-14T12:00:00.000Z',
    payload: { record: { id: 'SALE-0001', total: amount, cashbox: '01' } }
  };
}

test('la cola del cliente persiste operaciones y secuencias al reiniciar el proceso', t => {
  const options = fixture(t);
  const first = createDurableOutbox(options);
  const saved = first.enqueue(operation('event-1'));
  assert.equal(saved.deviceSeq, 1);
  assert.equal(first.pending().length, 1);

  const restarted = createDurableOutbox(options);
  const second = restarted.enqueue({ ...operation('event-2'), entityId: 'SALE-0002' });
  assert.equal(second.deviceSeq, 2);
  assert.deepEqual(restarted.pending().map(event => event.eventId), ['event-1', 'event-2']);
});

test('reintentar una misma operación pendiente devuelve el mismo evento y no consume otro consecutivo', t => {
  const options = fixture(t);
  const outbox = createDurableOutbox(options);
  const first = outbox.enqueue(operation('event-original'));
  const retry = outbox.enqueue(operation('event-retry'));
  assert.equal(retry.eventId, first.eventId);
  assert.equal(retry.deviceSeq, first.deviceSeq);
  assert.equal(outbox.status().pending, 1);
});

test('un ACK solo retira la operación de pendientes después de persistir el estado acked', t => {
  const options = fixture(t);
  const outbox = createDurableOutbox(options);
  outbox.enqueue(operation('event-ack'));
  outbox.acknowledge(['event-ack']);

  const restarted = createDurableOutbox(options);
  assert.deepEqual(restarted.pending(), []);
  assert.deepEqual(restarted.status(), { pending: 0, acknowledged: 1, conflicts: 0 });
});

test('los conflictos quedan preservados y no se reenvían automáticamente', t => {
  const options = fixture(t);
  const outbox = createDurableOutbox(options);
  outbox.enqueue(operation('event-conflict'));
  outbox.conflict(['event-conflict'], 'entity-already-exists-with-different-data');

  const restarted = createDurableOutbox(options);
  assert.deepEqual(restarted.pending(), []);
  assert.deepEqual(restarted.status(), { pending: 0, acknowledged: 0, conflicts: 1 });
});

test('un eventId reutilizado con datos diferentes se rechaza', t => {
  const options = fixture(t);
  const outbox = createDurableOutbox(options);
  outbox.enqueue(operation('event-fixed'));
  assert.throws(() => outbox.enqueue(operation('event-fixed', 999)), /identificador de operación ya existe/);
});

test('una cola dañada falla de forma cerrada sin borrarla ni reinicializarla', t => {
  const options = fixture(t);
  const file = path.join(options.directory, 'sifer360-network-outbox-v1.json');
  fs.writeFileSync(file, '{invalid-json', 'utf8');
  const outbox = createDurableOutbox(options);
  assert.throws(() => outbox.pending(), /cola LAN local está dañada/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid-json');
});

test('un fallo de escritura impide entregar el evento como operación encolada', t => {
  const options = fixture(t);
  const outbox = createDurableOutbox({
    ...options,
    fsImpl: {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      existsSync: fs.existsSync.bind(fs),
      openSync: () => { throw new Error('simulated disk failure'); },
      readFileSync: fs.readFileSync.bind(fs),
      unlinkSync: fs.unlinkSync.bind(fs)
    }
  });
  assert.throws(() => outbox.enqueue(operation('event-disk-failure')), /No se pudo confirmar la cola LAN en disco/);
  assert.equal(fs.existsSync(path.join(options.directory, 'sifer360-network-outbox-v1.json')), false);
});

test('los conflictos conservan el evento completo para diagnóstico después de reiniciar', t => {
  const options = fixture(t);
  const first = createDurableOutbox(options);
  first.enqueue(operation('event-diagnostic'));
  first.conflict(['event-diagnostic'], 'entity-already-exists-with-different-data');
  const restarted = createDurableOutbox(options);
  const conflicts = restarted.conflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].entityId, 'SALE-0001');
  assert.equal(conflicts[0].conflictReason, 'entity-already-exists-with-different-data');
  assert.equal(conflicts[0].payload.record.total, 10);
});
