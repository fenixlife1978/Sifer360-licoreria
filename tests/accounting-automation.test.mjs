import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractAutomationValue, isSafeAutomationPath } = require('../electron/accounting-automation.cjs');

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
