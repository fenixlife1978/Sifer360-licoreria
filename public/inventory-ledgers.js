'use strict';

/**
 * Dual inventory ledgers:
 * - operational stock is the existing product.stock and represents all physical units;
 * - fiscal stock is a separate, traceable balance built only from supported fiscal events.
 * This module never guesses opening fiscal balances from the operational stock.
 */
function ensureFiscalInventory(state) {
  if (!state || typeof state !== 'object') throw new TypeError('Estado POS inválido.');
  if (!state.fiscalInventory || typeof state.fiscalInventory !== 'object') {
    state.fiscalInventory = { version: 1, balances: {}, movements: [] };
  }
  const ledger = state.fiscalInventory;
  if (!ledger.balances || typeof ledger.balances !== 'object') ledger.balances = {};
  if (!Array.isArray(ledger.movements)) ledger.movements = [];
  ledger.version = 1;
  return ledger;
}

function fiscalBalance(state, code) {
  const ledger = ensureFiscalInventory(state);
  const row = ledger.balances[String(code)];
  return row ? Math.max(0, Number(row.stock) || 0) : 0;
}

function canApplyFiscalSale(state, lines) {
  const ledger = ensureFiscalInventory(state);
  const required = new Map();
  for (const line of lines || []) {
    const code = String(line.code || '');
    const qty = Number(line.qty);
    if (!code || !Number.isFinite(qty) || qty <= 0) return { ok: false, code, available: 0, required: qty };
    required.set(code, (required.get(code) || 0) + qty);
  }
  for (const [code, qty] of required) {
    const available = Math.max(0, Number(ledger.balances[code] && ledger.balances[code].stock) || 0);
    if (available + 1e-9 < qty) return { ok: false, code, available, required: qty };
  }
  return { ok: true };
}

function applyFiscalMovement(state, event) {
  const ledger = ensureFiscalInventory(state);
  const eventId = String(event && event.eventId || '');
  const code = String(event && event.code || '');
  const qty = Number(event && event.qty);
  const dir = String(event && event.dir || '');
  if (!eventId || !code || !Number.isFinite(qty) || qty <= 0 || !['IN', 'OUT'].includes(dir)) {
    throw new Error('Movimiento fiscal incompleto o inválido.');
  }
  const duplicate = ledger.movements.find(m => String(m.eventId) === eventId);
  if (duplicate) {
    const same = String(duplicate.code) === code
      && String(duplicate.dir) === dir
      && Math.abs(Number(duplicate.qty) - qty) < 1e-9
      && String(duplicate.sourceId || duplicate.eventId) === String(event.sourceId || eventId);
    if (!same) throw new Error('Conflicto de idempotencia: el identificador del movimiento ya existe con otros datos.');
    return { applied: false, duplicate: true };
  }
  const current = ledger.balances[code] || { stock: 0, cost: Number(event.cost) || 0 };
  const before = Math.max(0, Number(current.stock) || 0);
  if (dir === 'OUT' && before + 1e-9 < qty) {
    throw new Error('Existencia fiscal insuficiente para ' + code + ': disponible ' + before + ', requerido ' + qty + '.');
  }
  const after = dir === 'IN' ? before + qty : before - qty;
  const rawCost = event.cost === undefined ? current.cost : Number(event.cost);
  if (!Number.isFinite(Number(rawCost)) || Number(rawCost) < 0) throw new Error('Costo unitario fiscal inválido.');
  const cost = Number(rawCost);
  const nextCost = dir === 'IN' && after > 0
    ? ((before * (Number(current.cost) || 0)) + (qty * cost)) / after
    : (Number(current.cost) || cost);
  ledger.balances[code] = { stock: Math.round(after * 1e8) / 1e8, cost: Math.round(nextCost * 1e8) / 1e8 };
  ledger.movements.push({
    eventId, sourceId: String(event.sourceId || eventId), code, type: String(event.type || ''),
    dir, qty: Math.round(qty * 1e8) / 1e8, stockBefore: before,
    stockAfter: Math.round(after * 1e8) / 1e8, cost,
    document: String(event.document || ''), timestamp: Number(event.timestamp) || Date.now(),
    cashbox: String(event.cashbox || ''), user: String(event.user || '')
  });
  return { applied: true, stockBefore: before, stockAfter: after };
}

if (typeof window !== 'undefined') {
  window.SIFERInventoryLedgers = { ensureFiscalInventory, fiscalBalance, canApplyFiscalSale, applyFiscalMovement };
}
