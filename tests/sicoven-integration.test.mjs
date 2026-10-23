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
    kardex: [{ doc: 'FAC-00000001', type: 'VENTA', dir: 'OUT', qty: 1, cost: 50 }]
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


test('Sicoven contabiliza IVA adicional del 31% y ajustes de inventario', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.sales[0].total = 239;
  s.sales[0].pays[0].amount = 239;
  s.sales[0].lines = [
    { code: 'BEB-31', desc: 'Bebida gravada adicional', qty: 1, net: 100, iva: 31, taxRate: 31 },
    { code: 'BEB-8', desc: 'Bebida gravada reducida', qty: 1, net: 100, iva: 8, taxRate: 8 }
  ];
  s.purchases[0].base = 50;
  s.purchases[0].iva = 15.5;
  s.purchases[0].total = 65.5;
  s.purchases[0].paid = 65.5;
  s.purchases[0].lines = [{ code: 'BEB-31', qty: 1, cost: 50, sub: 50, iva: 15.5, taxRate: 31 }];
  s.kardex.push({ id: 2, doc: 'AJ-2', type: 'AJUSTE', dir: 'OUT', qty: 1, cost: 2, ts: 1790000002000 });
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 4);
  const sale = s.sicoven.entries.find(e => e.type === 'VENTA');
  const purchase = s.sicoven.entries.find(e => e.type === 'COMPRA');
  const adjustment = s.sicoven.entries.find(e => e.type === 'INVENTARIO');
  assert.ok(sale.lines.some(l => l.accountCode === '2.1.2.08'));
  assert.ok(sale.lines.some(l => l.accountCode === '4.1.1.05' && l.creditUsd === 100));
  assert.ok(sale.lines.some(l => l.accountCode === '4.1.1.06' && l.creditUsd === 100));
  assert.ok(purchase.lines.some(l => l.accountCode === '1.1.3.07'));
  assert.ok(adjustment);
  for (const entry of s.sicoven.entries) {
    assert.ok(Math.abs(entry.totals.debitUsd - entry.totals.creditUsd) <= 0.02, entry.id);
  }
});


test('Sicoven contabiliza abonos posteriores y conserva el pago inicial de compra sin duplicarlo', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.purchases[0].paid = 15;
  s.cxp = [{
    id: 'CXP-1', purchaseNo: 1, doc: 'COM-00000001', total: 48, paid: 15,
    payments: [
      { ts: 1790000001000, method: 'Transferencia Bs.', amountUsd: 10, amountBs: 400, ref: 'INI-1', note: 'Abono inicial en compra' },
      { ts: 1790000003000, method: 'Transferencia Bs.', amountUsd: 5, amountBs: 200, ref: 'PAGO-1', note: 'Pago parcial proveedor' }
    ]
  }];
  s.cxc = [{
    id: 'CXC-MANUAL-1', saleNo: null, doc: 'ND-1', ts: 1790000002000, total: 30, paid: 10,
    client: { name: 'Cliente prueba' },
    payments: [{ ts: 1790000004000, method: 'Transferencia Bs.', amountUsd: 10, amountBs: 400, ref: 'REC-1', note: 'Abono parcial' }]
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 6);
  assert.equal(s.sicoven.entries.filter(e => e.type === 'PAGO').length, 1);
  assert.equal(s.sicoven.entries.filter(e => e.type === 'COBRO').length, 1);
  assert.equal(s.sicoven.entries.filter(e => e.type === 'CXC_MANUAL').length, 1);
  const purchase = s.sicoven.entries.find(e => e.type === 'COMPRA');
  assert.equal(purchase.lines.find(l => l.description.includes('Pago proveedor')).debitUsd, 0);
  assert.ok(s.sicoven.entries.every(e => Math.abs(e.totals.debitUsd - e.totals.creditUsd) <= 0.02));
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven contabiliza liquidaciones Cashea con depósito real y comisión conciliados', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.sales[0].pays = [
    { id: 'efUSD', name: 'Efectivo USD', cur: 'USD', amount: 66 },
    { id: 'cashea', name: 'Cashea', cur: 'USD', amount: 50 }
  ];
  s.casheaLiquidaciones = [{
    id: 'LIQ-CSH-TEST', fecha: 1790000005000, operaciones: ['CSH-MOV-1'],
    brutoUsd: 50, comisionUsd: 5, depositadoUsd: 45, tasaBcv: 40,
    banco: 'Banesco Banco Universal', referencia: 'DEP-REAL-1'
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 4);
  const settlement = s.sicoven.entries.find(e => e.type === 'LIQUIDACION_CASHEA');
  assert.ok(settlement);
  assert.ok(settlement.lines.some(l => l.accountCode === '1.1.1.03' && l.debitUsd === 45));
  assert.ok(settlement.lines.some(l => l.accountCode === '6.1.1.07' && l.debitUsd === 5));
  assert.ok(settlement.lines.some(l => l.accountCode === '1.1.2.02' && l.creditUsd === 50));
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven contabiliza operaciones cambiarias y reconoce diferencias a tasa BCV', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.cambiosDivisas = [{
    id: 'CAMB-TEST-1', tipo: 'ZELLE_PROPIO', ts: 1790000006000,
    montoUsd: 10, montoBs: 400, tasa: 40, tasaBcv: 40,
    medioBs: 'Transferencia Bancaria', destinoTipo: 'BANCO_USD'
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 4);
  const fx = s.sicoven.entries.find(e => e.type === 'CAMBIO_DIVISAS');
  assert.ok(fx);
  assert.ok(fx.lines.some(l => l.accountCode === '1.1.1.05' && l.debitUsd === 10));
  assert.ok(fx.lines.some(l => l.accountCode === '1.1.1.03' && l.creditUsd === 10));
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven contabiliza movimientos de caja con contrapartida seleccionada y rechaza los no clasificados', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.movimientosCaja = [
    { id: 'MOV-TEST-1', ts: 1790000007000, direction: 'OUT', currency: 'USD', amount: 5, rate: 40, reason: 'Gasto de caja', counterpartAccount: '6.1.1.04' },
    { id: 'MOV-TEST-2', ts: 1790000008000, direction: 'IN', currency: 'BS', amount: 400, rate: 40, reason: 'Ingreso sin clasificar' }
  ];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 4);
  assert.equal(result.errors, 1);
  const movement = s.sicoven.entries.find(e => e.type === 'MOVIMIENTO_CAJA');
  assert.ok(movement);
  assert.ok(movement.lines.some(l => l.accountCode === '6.1.1.04' && l.debitUsd === 5));
  assert.ok(movement.lines.some(l => l.accountCode === '1.1.1.02' && l.creditUsd === 5));
  assert.ok(s.sicoven.errors.some(e => e.origin === 'MOV-MOV-TEST-2'));
});


test('Sicoven contabiliza retenciones ISLR y conserva el comprobante para exportación', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.cxp = [{ id: 'CXP-ISLR-TEST', purchaseNo: 1, doc: 'F-100 (COM-00001)', supplier: { name: 'Proveedor de prueba', rif: 'J123456789' }, total: 40, paid: 3, payments: [{ ts: 1790000009000, method: 'Retención ISLR', cur: 'VES', amountUsd: 3, amountBs: 120, ref: '20261000000001', note: 'Retención ISLR aplicada a factura F-100' }] }];
  s.sicoven.islrVouchers = [{
    id: 'ISLR-TEST-1', voucherNumber: '20261000000001', period: '202610',
    date: '2026-10-23', invoiceDate: '2026-10-23', supplierRif: 'J123456789',
    supplierName: 'Proveedor de prueba', invoiceNumber: 'F-100', controlNumber: '00-00100',
    conceptCode: '001', baseAmountBs: 4000, retentionRate: 3, subtrahendBs: 0,
    withheldAmountBs: 120, bcvRate: 40, baseAmountUsd: 100, withheldAmountUsd: 3, appliedToCxp: true, cxpId: 'CXP-ISLR-TEST', cxpPurchaseNo: 1
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 4);
  const entry = s.sicoven.entries.find(e => e.type === 'RETENCION_ISLR');
  assert.ok(entry);
  assert.ok(entry.lines.some(l => l.accountCode === '2.1.1.01' && l.debitUsd === 3));
  assert.ok(entry.lines.some(l => l.accountCode === '2.1.2.04' && l.creditUsd === 3));
  assert.equal(s.sicoven.entries.filter(e => e.type === 'PAGO').length, 0, 'La retención no se registra como salida bancaria ficticia.');
});


test('El módulo Sicoven está conectado a la navegación y a la persistencia SQLite del POS', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
  const chart = fs.readFileSync(new URL('../public/sicoven-chart.js', import.meta.url), 'utf8');
  const moduleSource = fs.readFileSync(new URL('../public/sicoven.js', import.meta.url), 'utf8');
  assert.ok(html.includes('id="btnSicovenTop"'));
  assert.ok(html.indexOf('src="/sicoven-chart.js"') < html.indexOf('src="/sicoven.js"'));
  assert.ok(main.includes('window.SIFERAccountingBridge'));
  assert.ok(main.includes('sicoven:S.sicoven||null'));
  assert.ok(main.includes('window.SIFERSicoven.syncFromPOS(S)'));
  assert.ok(chart.includes('window.SICOVEN_CHART'));
  assert.ok((chart.match(/"code":/g) || []).length >= 80);
  assert.doesNotThrow(() => new vm.Script(main, { filename: 'public/main.js' }));
  assert.doesNotThrow(() => new vm.Script(moduleSource, { filename: 'public/sicoven.js' }));
});


test('Sicoven contabiliza movimientos de caja y diferencias del Corte Z con la tasa guardada', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.movimientosCaja = [{
    id: 'MOV-CAJA-TEST-1', cashbox: '01', ts: 1790000007000,
    direction: 'IN', currency: 'BS', amount: 400, reason: 'Aporte de sencillo',
    counterpartAccount: '3.1.1.01', rate: 40
  }];
  s.cortesZ = [{
    id: 'Z-01-202610-0001', cashbox: '01', closedAt: 1790000008000, rate: 40,
    reconciliation: [
      { id: 'efUSD', name: 'Efectivo USD', cur: 'USD', system: 10, real: 8, diff: -2 },
      { id: 'efBs', name: 'Efectivo Bs.', cur: 'VES', system: 400, real: 480, diff: 80 }
    ]
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 5);
  const movement = s.sicoven.entries.find(e => e.type === 'MOVIMIENTO_CAJA');
  const cut = s.sicoven.entries.find(e => e.type === 'AJUSTE_ARQUEO');
  assert.ok(movement);
  assert.ok(movement.lines.some(l => l.accountCode === '1.1.1.01' && l.debitUsd === 10));
  assert.ok(movement.lines.some(l => l.accountCode === '3.1.1.01' && l.creditUsd === 10));
  assert.ok(cut);
  assert.ok(cut.lines.some(l => l.accountCode === '6.1.1.11' && l.debitUsd === 2));
  assert.ok(cut.lines.some(l => l.accountCode === '1.1.1.02' && l.creditUsd === 2));
  assert.ok(cut.lines.some(l => l.accountCode === '1.1.1.01' && l.debitUsd === 2));
  assert.ok(cut.lines.some(l => l.accountCode === '4.2.1.02' && l.creditUsd === 2));
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven evita duplicar la retención IVA que ya está incluida en el asiento de compra', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.purchases[0].retIva = 2;
  s.retencionesIva = [{
    id: 'RET-IVA-COMPRA-1', purchaseNo: 1, docProv: 'F-1', ts: 1790000009000,
    supplier: { rif: 'J-12345678-9', name: 'Proveedor de prueba' },
    retainedUsd: 2, retainedBs: 80, rate: 40
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 3);
  assert.equal(result.errors, 0);
  const purchase = s.sicoven.entries.find(e => e.type === 'COMPRA');
  assert.ok(purchase.lines.some(l => l.accountCode === '2.1.2.03' && l.creditUsd === 2));
  assert.equal(s.sicoven.entries.filter(e => e.type === 'RETENCION_IVA').length, 0);
});

test('Sicoven marca para revisión las retenciones IVA que no tienen compra o CxP vinculada', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.retencionesIva = [{
    id: 'RET-IVA-SIN-COMPRA', docProv: 'FACTURA-SIN-REGISTRO', ts: 1790000009000,
    supplier: { rif: 'J-99999999-9', name: 'Proveedor no asociado' },
    retainedUsd: 3, retainedBs: 120, rate: 40
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 3);
  assert.equal(result.errors, 1);
  assert.ok(s.sicoven.errors.some(e => e.origin === 'RETIVA-RET-IVA-SIN-COMPRA'));
  assert.equal(s.sicoven.entries.filter(e => e.type === 'RETENCION_IVA').length, 0);
});


test('Sicoven revierte los pagos CxP cuando se anula una compra y conserva trazabilidad', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.purchases[0].paid = 10;
  s.cxp = [{
    id: 'CXP-VOID-1', purchaseNo: 1, doc: 'F-200 (COM-00001)',
    supplier: { name: 'Proveedor prueba', rif: 'J-12345678-9' },
    total: 48, paid: 15,
    payments: [
      { ts: 1790000010000, method: 'Transferencia Bs.', cur: 'VES', amountUsd: 10, amountBs: 400, ref: 'INI-VOID-1', note: 'Abono inicial en compra' },
      { ts: 1790000011000, method: 'Transferencia Bs.', cur: 'VES', amountUsd: 5, amountBs: 200, ref: 'PAGO-VOID-1', note: 'Pago parcial proveedor' }
    ]
  }];
  const first = accounting.syncFromPOS(s);
  assert.equal(first.created, 4);
  const payment = s.sicoven.entries.find(e => e.type === 'PAGO');
  const purchase = s.sicoven.entries.find(e => e.type === 'COMPRA');
  assert.ok(payment);
  assert.ok(purchase);

  s.purchases[0].void = true;
  s.cxp[0].void = true;
  const reversed = accounting.syncFromPOS(s);
  assert.equal(reversed.created, 2);
  const paymentReverse = s.sicoven.entries.find(e => e.reversalOf === payment.id);
  const purchaseReverse = s.sicoven.entries.find(e => e.reversalOf === purchase.id);
  assert.ok(paymentReverse);
  assert.ok(purchaseReverse);
  assert.equal(paymentReverse.type, 'REVERSO');
  assert.equal(purchaseReverse.type, 'REVERSO');
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven rechaza retención ISLR no vinculada a una CxP abierta', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.sicoven.islrVouchers = [{
    id: 'ISLR-ORPHAN', voucherNumber: '20261000000009', period: '202610',
    date: '2026-10-23', invoiceDate: '2026-10-23', supplierRif: 'J999999999',
    supplierName: 'Proveedor sin obligación', invoiceNumber: 'F-999', controlNumber: '00-00999',
    conceptCode: '001', baseAmountBs: 1000, retentionRate: 3, subtrahendBs: 0,
    withheldAmountBs: 30, bcvRate: 40, baseAmountUsd: 25, withheldAmountUsd: 0.75
  }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 3);
  assert.equal(result.errors, 1);
  assert.ok(s.sicoven.errors.some(e => e.origin === 'ISLR-ISLR-ORPHAN'));
  assert.equal(s.sicoven.entries.filter(e => e.type === 'RETENCION_ISLR').length, 0);
});


test('Sicoven revierte el asiento ISLR y no mantiene retención activa cuando se anula la compra asociada', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.purchases[0].docProv = 'F-100';
  s.purchases[0].supplier = { name: 'Proveedor de prueba', rif: 'J123456789' };
  s.cxp = [{
    id: 'CXP-ISLR-VOID', purchaseNo: 1, doc: 'F-100 (COM-00001)',
    supplier: { name: 'Proveedor de prueba', rif: 'J123456789' },
    total: 40, paid: 3,
    payments: [{ ts: 1790000009000, method: 'Retención ISLR', cur: 'VES', amountUsd: 3, amountBs: 120, ref: 'ISLR-VOID-1', note: 'Retención ISLR aplicada a factura F-100' }]
  }];
  const voucher = {
    id: 'ISLR-VOID-1', voucherNumber: '20261000000010', period: '202610',
    date: '2026-10-23', invoiceDate: '2026-10-23', supplierRif: 'J123456789',
    supplierName: 'Proveedor de prueba', invoiceNumber: 'F-100', controlNumber: '00-00100',
    conceptCode: '001', baseAmountBs: 4000, retentionRate: 3, subtrahendBs: 0,
    withheldAmountBs: 120, bcvRate: 40, baseAmountUsd: 100, withheldAmountUsd: 3,
    appliedToCxp: true, cxpId: 'CXP-ISLR-VOID', cxpPurchaseNo: 1
  };
  s.sicoven.islrVouchers = [voucher];
  const first = accounting.syncFromPOS(s);
  assert.equal(first.created, 4);
  const original = s.sicoven.entries.find(e => e.type === 'RETENCION_ISLR');
  assert.ok(original);

  s.purchases[0].void = true;
  s.cxp[0].void = true;
  voucher.void = true;
  voucher.status = 'ANULADO JUNTO CON COMPRA COM-00001';
  const reversed = accounting.syncFromPOS(s);
  assert.equal(reversed.created, 2);
  assert.ok(s.sicoven.entries.some(e => e.type === 'REVERSO' && e.reversalOf === original.id));
  assert.ok(s.sicoven.entries.some(e => e.type === 'REVERSO' && e.reversalOf === 'SIC-COM-00000001-COMPRA'));
  assert.equal(accounting.syncFromPOS(s).created, 0);
});


test('Sicoven omite operaciones de valor cero sin generar asientos vacíos ni errores artificiales', () => {
  const accounting = loadAccountingModule();
  const s = state();
  s.kardex[0].cost = 0;
  s.kardex.push({ id: 2, type: 'INICIAL', dir: 'IN', qty: 8, cost: 0, ts: 1790000005000 });
  s.movimientosCaja = [{ id: 'MOV-ZERO', direction: 'IN', currency: 'USD', amount: 0, rate: 40, counterpartAccount: '3.1.1.01', ts: 1790000006000 }];
  s.cambiosDivisas = [{ id: 'CAMB-ZERO', tipo: 'USD_EFECTIVO', montoUsd: 0, montoBs: 0, tasaBcv: 40, ts: 1790000007000 }];
  s.cxc = [{ id: 'CXC-ZERO', saleNo: null, doc: 'ND-ZERO', total: 0, paid: 0, payments: [] }];
  s.cxp = [{ id: 'CXP-ZERO', purchaseNo: null, doc: 'F-ZERO', total: 0, paid: 0, payments: [] }];
  const result = accounting.syncFromPOS(s);
  assert.equal(result.created, 2);
  assert.equal(result.errors, 0);
  assert.ok(s.sicoven.entries.every(e => e.lines.length > 0));
  assert.ok(!s.sicoven.entries.some(e => ['COSTO_VENTA', 'INVENTARIO', 'MOVIMIENTO_CAJA', 'CAMBIO_DIVISAS'].includes(e.type)));
});

test('Sicoven impide conciliar dos movimientos bancarios contra el mismo asiento', () => {
  const source = fs.readFileSync(new URL('../public/sicoven.js', import.meta.url), 'utf8');
  assert.match(source, /const alreadyMatched=new Set\(c\.bankMovements\.filter\(x=>x\.status==='CONCILIADO'/);
  assert.match(source, /ya está conciliado con otro movimiento bancario/);
  assert.match(source, /m\.status='CONCILIADO';m\.matchedEntryId=entry\.id/);
});
