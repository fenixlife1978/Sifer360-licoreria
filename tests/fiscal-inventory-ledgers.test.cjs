'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureFiscalInventory, fiscalBalance, canApplyFiscalSale, applyFiscalMovement } = require('../public/inventory-ledgers.cjs');

test('fiscal ledger never guesses its opening balance from operational stock', () => {
  const state = { products: [{ code: 'SKU-1', stock: 30 }] };
  assert.equal(fiscalBalance(state, 'SKU-1'), 0);
  assert.deepEqual(state.fiscalInventory, { version: 1, balances: {}, movements: [] });
});

test('fiscal purchases add to fiscal stock and duplicate source events are idempotent', () => {
  const state = {};
  const event = { eventId: 'PUR-1:SKU-1', sourceId: 'PUR-1', code: 'SKU-1', type: 'COMPRA_FISCAL', dir: 'IN', qty: 10, cost: 4, document: 'COM-1' };
  assert.equal(applyFiscalMovement(state, event).applied, true);
  assert.equal(applyFiscalMovement(state, event).duplicate, true);
  assert.equal(fiscalBalance(state, 'SKU-1'), 10);
  assert.equal(ensureFiscalInventory(state).movements.length, 1);
});

test('non-fiscal purchases do not create fiscal stock; fiscal sale validation blocks unsupported negative stock', () => {
  const state = {};
  assert.deepEqual(canApplyFiscalSale(state, [{ code: 'SKU-1', qty: 1 }]), { ok: false, code: 'SKU-1', available: 0, required: 1 });
  applyFiscalMovement(state, { eventId: 'OPEN-1', code: 'SKU-1', type: 'APERTURA_FISCAL', dir: 'IN', qty: 5, cost: 3 });
  assert.equal(canApplyFiscalSale(state, [{ code: 'SKU-1', qty: 4 }]).ok, true);
  assert.equal(canApplyFiscalSale(state, [{ code: 'SKU-1', qty: 6 }]).ok, false);
});

test('fiscal sales reduce fiscal stock; ticket sales must not call this ledger', () => {
  const state = {};
  applyFiscalMovement(state, { eventId: 'OPEN-1', code: 'SKU-1', type: 'APERTURA_FISCAL', dir: 'IN', qty: 8, cost: 3 });
  applyFiscalMovement(state, { eventId: 'SALE-FISCAL-1', code: 'SKU-1', type: 'VENTA_FISCAL', dir: 'OUT', qty: 2, cost: 3 });
  assert.equal(fiscalBalance(state, 'SKU-1'), 6);
  assert.equal(ensureFiscalInventory(state).movements.length, 2);
});

test('fiscal stock refuses an outgoing movement greater than its balance', () => {
  const state = {};
  assert.throws(() => applyFiscalMovement(state, { eventId: 'SALE-1', code: 'SKU-1', type: 'VENTA_FISCAL', dir: 'OUT', qty: 1 }), /insuficiente/);
});


test('an eventId repeated with different fiscal payload is rejected instead of silently ignored', () => {
  const state = {};
  const original = { eventId: 'PUR-2:SKU-2', sourceId: 'PUR-2', code: 'SKU-2', type: 'COMPRA_FISCAL', dir: 'IN', qty: 4, cost: 2 };
  applyFiscalMovement(state, original);
  assert.equal(applyFiscalMovement(state, { ...original }).duplicate, true);
  assert.throws(
    () => applyFiscalMovement(state, { ...original, qty: 40 }),
    /Conflicto de idempotencia/
  );
  assert.throws(
    () => applyFiscalMovement(state, { ...original, code: 'SKU-OTHER' }),
    /Conflicto de idempotencia/
  );
  assert.equal(fiscalBalance(state, 'SKU-2'), 4);
  assert.equal(fiscalBalance(state, 'SKU-OTHER'), 0);
});

test('fiscal movement rejects negative or non-finite unit costs', () => {
  const state = {};
  assert.throws(() => applyFiscalMovement(state, {
    eventId: 'BAD-COST-1', code: 'SKU-3', dir: 'IN', qty: 1, cost: -0.01
  }), /Costo unitario fiscal inválido/);
  assert.throws(() => applyFiscalMovement(state, {
    eventId: 'BAD-COST-2', code: 'SKU-3', dir: 'IN', qty: 1, cost: Number.NaN
  }), /Costo unitario fiscal inválido/);
  assert.equal(fiscalBalance(state, 'SKU-3'), 0);
});

test('reusing an eventId with a different unit cost or movement type is rejected', () => {
  const state = {};
  const event = { eventId: 'PUR-4:SKU-4', sourceId: 'PUR-4', code: 'SKU-4', type: 'COMPRA_FISCAL', dir: 'IN', qty: 2, cost: 5 };
  applyFiscalMovement(state, event);
  assert.throws(() => applyFiscalMovement(state, { ...event, cost: 6 }), /Conflicto de idempotencia/);
  assert.throws(() => applyFiscalMovement(state, { ...event, type: 'AJUSTE_FISCAL' }), /Conflicto de idempotencia/);
  assert.equal(fiscalBalance(state, 'SKU-4'), 2);
});

test('traceable fiscal adjustments preserve document, reason and resulting balance', () => {
  const state = { fiscalInventory: { version: 1, balances: { 'SKU-A': { stock: 7, cost: 4 } }, movements: [] } };
  const incoming = { eventId: 'ADJ-IN-1', sourceId: 'ADJ-IN-1', code: 'SKU-A', type: 'AJUSTE_FISCAL', dir: 'IN', qty: 2, cost: 5, document: 'ACTA-01', reason: 'Diferencia física documentada' };
  assert.equal(applyFiscalMovement(state, incoming).applied, true);
  assert.equal(fiscalBalance(state, 'SKU-A'), 9);
  assert.equal(state.fiscalInventory.movements[0].document, 'ACTA-01');
  assert.equal(state.fiscalInventory.movements[0].reason, 'Diferencia física documentada');
  const outgoing = { eventId: 'ADJ-OUT-1', sourceId: 'ADJ-OUT-1', code: 'SKU-A', type: 'AJUSTE_FISCAL', dir: 'OUT', qty: 3, cost: 4, document: 'ACTA-02', reason: 'Merma conciliada' };
  applyFiscalMovement(state, outgoing);
  assert.equal(fiscalBalance(state, 'SKU-A'), 6);
  assert.equal(state.fiscalInventory.movements[1].reason, 'Merma conciliada');
  assert.throws(() => applyFiscalMovement(state, { ...outgoing, eventId: 'ADJ-OUT-2', sourceId: 'ADJ-OUT-2', qty: 7 }), /Existencia fiscal insuficiente/);
  assert.equal(fiscalBalance(state, 'SKU-A'), 6);
});

test('reusing an adjustment eventId with a different reason is rejected', () => {
  const state = {};
  const event = { eventId: 'ADJ-IDEMPOTENT', sourceId: 'ADJ-IDEMPOTENT', code: 'SKU-B', type: 'AJUSTE_FISCAL', dir: 'IN', qty: 1, cost: 2, document: 'ACTA-03', reason: 'Conteo aprobado' };
  applyFiscalMovement(state, event);
  assert.throws(() => applyFiscalMovement(state, { ...event, reason: 'Otro motivo' }), /Conflicto de idempotencia/);
  assert.equal(fiscalBalance(state, 'SKU-B'), 1);
});
