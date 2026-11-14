import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getCashboxSequenceMinimum } = require('../electron/cashbox-sequence-minimum.cjs');

test('calcula consecutivos desde los documentos de la caja central y mantiene cajas independientes', () => {
  const state = {
    sales: [
      { cashbox: '01', no: 18, ctrlNo: '00-00018', voidNo: 2 },
      { cashbox: '02', no: 91, ctrlNo: '00-00091', voidNo: 7 }
    ],
    cortesZ: [{ cashbox: '01', id: 'Z-01-00008' }, { cashbox: '02', id: 'Z-02-00031' }],
    purchases: [{ cashbox: '01', no: 5 }, { cashbox: '02', no: 12 }]
  };
  assert.equal(getCashboxSequenceMinimum(state, '01', 'invoice'), 19);
  assert.equal(getCashboxSequenceMinimum(state, '02', 'invoice'), 92);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'control'), 19);
  assert.equal(getCashboxSequenceMinimum(state, '02', 'z'), 32);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'purchase'), 6);
  assert.equal(getCashboxSequenceMinimum(state, '02', 'void'), 8);
});

test('los pagos se numeran por la caja que efectúa el pago, aunque el documento padre sea de otra caja', () => {
  const state = {
    cxc: [
      { cashbox: '01', payments: [{ cashbox: '02', cashboxSequence: 8 }, { cashbox: '01', cashboxSequence: 3 }] },
      { cashbox: '03', payments: [{ cashbox: '02', cashboxSequence: 11 }] }
    ],
    cxp: [{ cashbox: '01', payments: [{ cashbox: '04', cashboxSequence: 19 }] }]
  };
  assert.equal(getCashboxSequenceMinimum(state, '02', 'cxc-payment'), 12);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'cxc-payment'), 4);
  assert.equal(getCashboxSequenceMinimum(state, '04', 'cxp-payment'), 20);
  assert.equal(getCashboxSequenceMinimum(state, '03', 'cxp-payment'), 1);
});

test('calcula retenciones por período, conteos, CxC, CxP, Cashea, divisas y movimientos', () => {
  const state = {
    counts: [{ cashbox: '01', sequence: 7 }],
    cxc: [{ cashbox: '01', sequence: 12 }],
    cxp: [{ cashbox: '01', sequence: 13 }],
    casheaMovimientos: [{ cashbox: '01', sequence: 14 }],
    retencionesIva: [{ cashbox: '01', periodo: '202611', sequence: 5 }, { cashbox: '01', periodo: '202610', sequence: 99 }],
    cambiosDivisas: [{ cashbox: '01', sequence: 16 }],
    movimientosCaja: [{ cashbox: '01', sequence: 17 }],
    returns: [{ cashbox: '01', returnNo: 18 }]
  };
  assert.equal(getCashboxSequenceMinimum(state, '01', 'count'), 8);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'cxc'), 13);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'cxp'), 14);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'cashea'), 15);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'retention-202611'), 6);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'currency-exchange'), 17);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'movement'), 18);
  assert.equal(getCashboxSequenceMinimum(state, '01', 'return'), 19);
});

test('no permite desbordar el rango seguro de los consecutivos centrales', () => {
  assert.throws(() => getCashboxSequenceMinimum({ sales: [{ cashbox: '01', no: Number.MAX_SAFE_INTEGER }] }, '01', 'invoice'), /rango seguro/);
});
