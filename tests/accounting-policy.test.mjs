import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertAccountingSettingsChange,
  assertAccountingPeriodChange
} = require('../electron/accounting-policy.cjs');

const before = {
  accounting_framework: 'VEN_NIF_PYME',
  functional_currency: 'VES',
  presentation_currency: 'USD',
  monetary_decimals: 2
};
const unchanged = {
  accountingFramework: 'VEN_NIF_PYME',
  functionalCurrency: 'VES',
  presentationCurrency: 'USD',
  monetaryDecimals: 2
};

test('bloquea cambios de marco y base monetaria cuando ya existen asientos', () => {
  assert.throws(() => assertAccountingSettingsChange(before, { ...unchanged, functionalCurrency: 'USD' }, 1), /No se puede cambiar/);
  assert.throws(() => assertAccountingSettingsChange(before, { ...unchanged, presentationCurrency: 'VES' }, 2), /No se puede cambiar/);
  assert.throws(() => assertAccountingSettingsChange(before, { ...unchanged, monetaryDecimals: 3 }, 1), /No se puede cambiar/);
  assert.throws(() => assertAccountingSettingsChange(before, { ...unchanged, accountingFramework: 'VEN_NIF_GE' }, 1), /No se puede cambiar/);
});

test('permite cambiar política y modo de automatización sin alterar la base monetaria', () => {
  assert.equal(assertAccountingSettingsChange(before, unchanged, 4), true);
});

test('permite configurar o cambiar la base contable antes del primer asiento', () => {
  assert.equal(assertAccountingSettingsChange(null, unchanged, 0), true);
  assert.equal(assertAccountingSettingsChange(before, { ...unchanged, functionalCurrency: 'USD' }, 0), true);
});

test('un período cerrado nunca se puede modificar', () => {
  assert.throws(() => assertAccountingPeriodChange({ status: 'closed', startDate: '2026-11-01', endDate: '2026-11-30' }, { startDate: '2026-11-01', endDate: '2026-11-30' }, 0), /período cerrado/);
});

test('protege fechas de períodos con asientos y permite corregir solo su etiqueta', () => {
  const period = { status: 'open', startDate: '2026-11-01', endDate: '2026-11-30' };
  assert.throws(() => assertAccountingPeriodChange(period, { startDate: '2026-11-02', endDate: '2026-11-30' }, 1), /ya contiene asientos/);
  assert.equal(assertAccountingPeriodChange(period, { startDate: '2026-11-01', endDate: '2026-11-30' }, 1), true);
});
