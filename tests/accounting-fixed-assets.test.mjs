import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
const require=createRequire(import.meta.url);
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
  assert.match(preload, /accountingListAssetAcquisitionEntries/);
  assert.match(main, /accounting:list-asset-acquisition-entries/);
  assert.match(main, /'accounting:list-fixed-assets','accounting:list-asset-acquisition-entries'/);
  assert.match(pos, /btnGenerateAssetDepreciation/);
  assert.match(pos, /accountingGenerateAssetDepreciationDrafts/);
});

test('el cierre detecta depreciaciones de activos faltantes, revertidas o con meses previos pendientes', async () => {
  const match=main.match(/const pendingAssetDepreciations = period \? Number\(one\(`([\s\S]*?)`, \[periodId/);
  assert.ok(match, 'la consulta de depreciación debe permanecer conectada al cierre de períodos');
  const SQL=await initSqlJs({locateFile:file=>require.resolve('sql.js/dist/'+file)});
  const db=new SQL.Database();
  db.run('CREATE TABLE accounting_fixed_assets(id TEXT,status TEXT,depreciation_start_month TEXT,available_for_use_date TEXT,useful_life_months INTEGER)');
  db.run('CREATE TABLE accounting_asset_depreciations(id TEXT,asset_id TEXT,depreciation_month TEXT,status TEXT)');
  db.run("INSERT INTO accounting_fixed_assets VALUES('A1','active','2026-10','2026-10-01',60)");
  const params=['2026-11','2026-11','2026-11-30','2026-11','2026-11','2026-11','2026-11','2026-11'];
  const pending=()=>{
    const statement=db.prepare(match[1]);
    try{statement.bind(params);return statement.step()?Number(statement.getAsObject().total):0;}
    finally{statement.free();}
  };
  assert.equal(pending(),1,'sin borrador o contabilización no se puede cerrar');
  db.run("INSERT INTO accounting_asset_depreciations VALUES('D1','A1','2026-10','posted')");
  assert.equal(pending(),1,'falta la depreciación del mes actual');
  db.run("INSERT INTO accounting_asset_depreciations VALUES('D2','A1','2026-11','posted')");
  assert.equal(pending(),0,'mes actual y meses previos contabilizados');
  db.run("UPDATE accounting_asset_depreciations SET status='reversed' WHERE id='D2'");
  assert.equal(pending(),1,'una depreciación reversada requiere regularización');
  db.run("UPDATE accounting_asset_depreciations SET status='posted' WHERE id='D2'");
  db.run("DELETE FROM accounting_asset_depreciations WHERE id='D1'");
  assert.equal(pending(),1,'no permite saltar meses anteriores');
  db.close();
});
