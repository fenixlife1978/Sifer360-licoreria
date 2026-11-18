import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateStraightLineDepreciation } from '../src/accounting/fixed-assets.mjs';

const schema = readFileSync(new URL('../src/accounting/fixed-assets-schema.sql', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

test('depreciación lineal distribuye importes enteros y reserva el remanente para el último mes', () => {
  assert.equal(calculateStraightLineDepreciation({ costMinor: 10000, residualMinor: 1000, usefulLifeMonths: 3, monthsAlreadyDepreciated: 0 }), 3000);
  assert.equal(calculateStraightLineDepreciation({ costMinor: 10000, residualMinor: 1000, usefulLifeMonths: 3, monthsAlreadyDepreciated: 1 }), 3000);
  assert.equal(calculateStraightLineDepreciation({ costMinor: 10000, residualMinor: 1000, usefulLifeMonths: 3, monthsAlreadyDepreciated: 2 }), 3000);
  assert.equal(calculateStraightLineDepreciation({ costMinor: 10001, residualMinor: 1000, usefulLifeMonths: 3, monthsAlreadyDepreciated: 2 }), 3001);
  assert.equal(calculateStraightLineDepreciation({ costMinor: 10000, residualMinor: 1000, usefulLifeMonths: 3, monthsAlreadyDepreciated: 3 }), 0);
});

test('rechaza importes, vidas útiles y contadores inválidos', () => {
  assert.throws(() => calculateStraightLineDepreciation({ costMinor: 100, residualMinor: 100, usefulLifeMonths: 2 }), /no son válidos/);
  assert.throws(() => calculateStraightLineDepreciation({ costMinor: 100, residualMinor: 0, usefulLifeMonths: 0 }), /no son válidos/);
  assert.throws(() => calculateStraightLineDepreciation({ costMinor: 100, residualMinor: 0, usefulLifeMonths: 2, monthsAlreadyDepreciated: 3 }), /no son válidos/);
});

test('el auxiliar exige vínculo a adquisición, cuentas contables y períodos; evita duplicar mes por activo', () => {
  assert.match(schema, /acquisition_entry_id TEXT NOT NULL REFERENCES journal_entries/);
  assert.match(schema, /UNIQUE\(asset_id,depreciation_month\)/);
  assert.match(schema, /UNIQUE\(acquisition_entry_id,asset_account_code,cost_minor\)/);
  assert.match(schema, /journal_entry_id TEXT NOT NULL UNIQUE REFERENCES journal_entries/);
});

test('la depreciación genera borradores en SQLite y exige aprobación del contador', () => {
  assert.match(main, /accounting:generate-asset-depreciation-drafts/);
  assert.match(main, /sourceType:'asset_depreciation'/);
  assert.match(main, /accounting_asset_depreciations/);
  assert.match(main, /actor\.actorRole!=='contador'/);
  assert.match(preload, /accountingGenerateAssetDepreciationDrafts/);
  assert.match(pos, /btnGenerateAssetDepreciation/);
  assert.match(pos, /accountingGenerateAssetDepreciationDrafts/);
});
