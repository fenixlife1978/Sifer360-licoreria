import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadAccountingModule() {
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    head: { appendChild() {} }
  };
  const window = {};
  const context = { window, document, console, Intl, Date, Math, Number, String, Array, Object, Map, JSON, Blob: class Blob {}, URL: {}, alert() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sicoven.js', import.meta.url), 'utf8'), context);
  return window.SIFERSicoven;
}
function state() {
  return {
    cfg: { empresa: 'Licorería de prueba', rate: 40 },
    sicoven: { version: 1, config: {}, entries: [], errors: [] },
    sales: [{
      no: 1, ts: 1790000000000, rate: 40, total: 116, igtf: 0, credit: 0, void: false,
      pays: [{ id: 'efUSD', name: 'Efectivo USD', cur: 'USD', amount: 116 }],
      lines: [{ code: 'BEB-1', desc: 'Producto', qty: 1, net: 100, iva: 16, taxRate: 16 }]
    }],
    purchases: [{ no: 1, ts: 1790000001000, rate: 40, base: 50, iva: 8, total: 58, retIva: 0, paid: 10, void: false }],
    kardex: [{ doc: 'FAC-1', type: 'VENTA', dir: 'OUT', qty: 1, cost: 50 }]
  };
}

test('Sicoven genera asientos balanceados para venta, costo de venta y compra', () => {
  const accounting = loadAccountingModule();
  const s = state();
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 3);
  assert.equal(result.errors, 0);
  assert.equal(s.sicoven.entries.length, 3);
  for (const entry of s.sicoven.entries) {
    assert.ok(Math.abs(entry.totals.debitUsd - entry.totals.creditUsd) <= 0.02, entry.id);
    assert.ok(Math.abs(entry.totals.debitBs - entry.totals.creditBs) <= 0.03, entry.id);
  }
});

test('Sicoven no duplica asientos cuando sincroniza la misma operación dos veces', () => {
  const accounting = loadAccountingModule();
  const s = state();
  accounting.syncFromPOS(s);
  const second = accounting.syncFromPOS(s);
  assert.equal(second.created, 0);
  assert.equal(s.sicoven.entries.length, 3);
});

test('Sicoven genera reversos auditables al anular una venta contabilizada', () => {
  const accounting = loadAccountingModule();
  const s = state();
  accounting.syncFromPOS(s);
  s.sales[0].void = true;
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 2);
  assert.equal(s.sicoven.entries.filter(e => e.type === 'REVERSO').length, 2);
  assert.equal(s.sicoven.entries.length, 5);
});
