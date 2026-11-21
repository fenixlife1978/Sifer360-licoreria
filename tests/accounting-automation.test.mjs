import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractAutomationValue, isSafeAutomationPath, normalizeAutomationLines, buildAutomationJournalLines } = require('../electron/accounting-automation.cjs');
const { decimalToMinorUnits } = await import('../src/accounting/engine.mjs');

test('lee importes en rutas simples y anidadas sin mutar el documento', () => {
  const record = { total: '125.50', totals: { grandTotal: 987.65 }, currency: 'VES' };
  assert.equal(extractAutomationValue(record, 'total'), '125.50');
  assert.equal(extractAutomationValue(record, 'totals.grandTotal'), 987.65);
  assert.equal(extractAutomationValue(record, 'currency'), 'VES');
  assert.equal(record.totals.grandTotal, 987.65);
});

test('devuelve undefined si el campo no existe y rechaza rutas inseguras', () => {
  assert.equal(extractAutomationValue({ total: 1 }, 'totals.grandTotal'), undefined);
  assert.throws(() => extractAutomationValue({}, '__proto__.polluted'), /no es válida|prohibido/);
  assert.throws(() => extractAutomationValue({}, 'constructor.prototype'), /no es válida|prohibido/);
  assert.throws(() => extractAutomationValue({ total: { amount: 1 } }, 'total'), /objeto/);
  assert.throws(() => extractAutomationValue({}, 'total[0]'), /no es válida/);
});

test('no permite leer propiedades heredadas ni operar sobre arrays', () => {
  const proto = { total: 100 };
  const record = Object.create(proto);
  assert.equal(extractAutomationValue(record, 'total'), undefined);
  assert.equal(extractAutomationValue([{ total: 100 }], '0.total'), undefined);
});

test('valida rutas de campos para reglas sin permitir acceso a prototipos ni expresiones', () => {
  assert.equal(isSafeAutomationPath('total'), true);
  assert.equal(isSafeAutomationPath('totals.grandTotal'), true);
  assert.equal(isSafeAutomationPath('total[0]'), false);
  assert.equal(isSafeAutomationPath('__proto__.polluted'), false);
  assert.equal(isSafeAutomationPath('constructor.prototype'), false);
  assert.equal(isSafeAutomationPath(''), false);
});

test('genera asientos con varias contrapartidas para venta neta, retención e IVA', () => {
  const lines = buildAutomationJournalLines({
    record:{netAmount:'116.00',withholding:'4.00',subtotal:'100.00',tax:'20.00',customerId:'CLI-01',costCenter:'LICORERIA'},
    monetaryDecimals:2,
    decimalToMinorUnits,
    fallbackDescription:'Venta POS',
    lines:[
      {side:'debit',accountCode:'1.1.1.01',amountPath:'netAmount'},
      {side:'debit',accountCode:'1.1.2.05',amountPath:'withholding',thirdPartyPath:'customerId'},
      {side:'credit',accountCode:'4.1.1.01',amountPath:'subtotal',costCenterPath:'costCenter'},
      {side:'credit',accountCode:'2.1.3.01',amountPath:'tax'}
    ]
  });
  assert.equal(lines.length,4);
  assert.equal(lines.reduce((n,line)=>n+line.debitMinor,0),12000);
  assert.equal(lines.reduce((n,line)=>n+line.creditMinor,0),12000);
  assert.equal(lines[1].thirdPartyId,'CLI-01');
  assert.equal(lines[2].costCenter,'LICORERIA');
});

test('permite un único renglón residual explícito para diferencias documentadas de redondeo', () => {
  const lines = buildAutomationJournalLines({
    record:{debit:'10.00',credit:'9.99'},
    monetaryDecimals:2,
    decimalToMinorUnits,
    lines:[
      {side:'debit',accountCode:'1.1.1.01',amountPath:'debit'},
      {side:'credit',accountCode:'4.1.1.01',amountPath:'credit'},
      {side:'credit',accountCode:'7.1.9.01',amountMode:'residual'}
    ]
  });
  assert.equal(lines[2].creditMinor,1);
  assert.equal(lines.reduce((n,line)=>n+line.debitMinor,0),1000);
  assert.equal(lines.reduce((n,line)=>n+line.creditMinor,0),1000);
});

test('rechaza rutas inseguras, lados inválidos, varias líneas residuales y asientos descuadrados', () => {
  assert.throws(() => normalizeAutomationLines([
    {side:'debit',accountCode:'1.1.1.01',amountPath:'total.__proto__'},
    {side:'credit',accountCode:'4.1.1.01',amountPath:'total'}
  ]), /ruta de importe válida/);
  assert.throws(() => normalizeAutomationLines([
    {side:'debit',accountCode:'1.1.1.01',amountPath:'total'},
    {side:'credit',accountCode:'4.1.1.01',amountPath:'total'},
    {side:'credit',accountCode:'7.1.9.01',amountMode:'residual'},
    {side:'credit',accountCode:'7.1.9.02',amountMode:'residual'}
  ]), /último|solo puede contener/);
  assert.throws(() => buildAutomationJournalLines({
    record:{debit:'10.00',credit:'8.00'},monetaryDecimals:2,decimalToMinorUnits,
    lines:[
      {side:'debit',accountCode:'1.1.1.01',amountPath:'debit'},
      {side:'credit',accountCode:'4.1.1.01',amountPath:'credit'}
    ]
  }), /no cuadra/);
});
