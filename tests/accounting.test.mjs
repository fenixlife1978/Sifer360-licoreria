import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chart = JSON.parse(readFileSync(new URL('../public/data/plan-cuentas-predeterminado-ven-nif.json', import.meta.url), 'utf8'));
const accounting = readFileSync(new URL('../public/accounting.js', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('el catálogo VEN-NIF importado conserva las 97 cuentas y sus códigos únicos', () => {
  assert.equal(chart.accountCount, 97);
  assert.equal(chart.accounts.length, 97);
  assert.equal(new Set(chart.accounts.map(a => a.code)).size, 97);
  assert.equal(chart.accounts.filter(a => a.isMovement).length, 68);
  assert.equal(chart.accounts.filter(a => !a.isMovement).length, 29);
});

test('todas las cuentas agrupadoras referencian padres existentes', () => {
  const codes = new Set(chart.accounts.map(a => a.code));
  assert.ok(chart.accounts.every(a => !a.parentCode || codes.has(a.parentCode)));
  assert.ok(chart.accounts.every(a => Number.isInteger(a.level) && a.level > 0));
});

test('el diario solo admite cuentas imputables y exige cuadratura dual', () => {
  assert.match(accounting, /if\(!account\|\|!account\.isMovement\)/);
  assert.match(accounting, /Math\.abs\(dU-cU\)>=0\.01/);
  assert.match(accounting, /Math\.abs\(dB-cB\)>=0\.01/);
  assert.match(accounting, /El asiento no cuadra/);
});

test('la reversión crea un asiento inverso y conserva el original', () => {
  assert.match(accounting, /Reversión de '\+original\.number/);
  assert.match(accounting, /reversalOf:id/);
  assert.match(accounting, /if\(a\.entries\.some\(e=>e\.reversalOf===id\)\)/);
  assert.match(accounting, /debitUsd:l\.creditUsd,creditUsd:l\.debitUsd,debitBs:l\.creditBs,creditBs:l\.debitBs/);
});

test('las operaciones POS exponen referencias estables y costo histórico para contabilización', () => {
  assert.match(pos, /accountingSourceId:'SALE-'\+String\(currentCaja\(\)\)/);
  assert.match(pos, /unitCost:i\.p\.cost/);
  assert.match(pos, /accountingSourceId:'PURCHASE-'\+pad\(no\)/);
  assert.match(pos, /cost:l\.cost/);
});

test('la integración POS exige configurar cuentas imputables por método y operación', () => {
  assert.match(accounting, /function renderIntegration\(\)/);
  assert.match(accounting, /data-pay-account/);
  assert.match(accounting, /data-integration-account/);
  assert.match(accounting, /movementAccounts\(\)/);
  assert.match(accounting, /No se asignan bancos agrupadores automáticamente/);
  assert.match(accounting, /function saveIntegration\(\)/);
  assert.match(accounting, /\['integration','Integración POS'\]/);
});

test('la contabilidad se incluye en el snapshot SQLite y se restaura al iniciar', () => {
  assert.match(pos, /accounting:S\.accounting\|\|/);
  assert.match(pos, /S\.accounting=d\.accounting&&typeof d\.accounting==='object'/);
  assert.match(pos, /window\.SIFERAccountingBridge=\{getState:\(\)=>S,save:\(\)=>save\(\)/);
});

test('el módulo contable se carga después del POS y tiene acceso desde menú y toolbar', () => {
  assert.ok(html.indexOf('/main.js') < html.indexOf('/accounting.js'));
  assert.match(pos, /'Contabilidad':\[\['Contabilidad general VEN-NIF/);
  assert.match(pos, /\['contabilidad','Contabilidad'/);
});

test('los accesos a Contabilidad VEN-NIF no fallan silenciosamente si el módulo no carga', () => {
  assert.match(pos, /function openAccountingModule\(\)/);
  assert.match(pos, /Contabilidad VEN-NIF no está disponible/);
  assert.match(pos, /'Contabilidad':\[\['Contabilidad general VEN-NIF…','',openAccountingModule\]\]/);
  assert.match(pos, /\['contabilidad','Contabilidad','',openAccountingModule\]/);
  assert.match(accounting, /window\.SIFERAccountingApp=\{open\}/);
});

test('estados financieros usan asientos contabilizados y fecha de corte', () => {
  assert.match(accounting, /function renderStatements\(\)/);
  assert.match(accounting, /Estado de situación financiera/);
  assert.match(accounting, /Estado de resultados acumulado/);
  assert.match(accounting, /Flujo de efectivo registrado/);
  assert.match(accounting, /filter\(e=>String\(e\.date\)<=date\)/);
});

test('activos fijos usan cuentas de depreciación acumulada existentes', () => {
  for (const code of ['1.2.1.05','1.2.1.06','1.2.1.07','6.1.1.06']) {
    assert.ok(chart.accounts.some(a => a.code === code && a.isMovement), 'falta cuenta imputable '+code);
  }
  assert.match(accounting, /function depreciateAsset\\(id,target\\)/);
  assert.match(accounting, /depreciationPeriod:month/);
  assert.match(accounting, /lastDepreciationMonth/);
  assert.match(accounting, /asset\.monthsDepreciated=count/);
});

test('la depreciación mensual se ejecuta automáticamente y recupera períodos completos pendientes', () => {
  assert.match(accounting, /function runAutomaticDepreciation\(\)/);
  assert.match(accounting, /function startAutomaticDepreciation\(\)/);
  assert.match(accounting, /setInterval\(runAutomaticDepreciation,60000\)/);
  assert.match(accounting, /window\.addEventListener\('sifer:ready',startAutomaticDepreciation/);
  assert.match(accounting, /function lastCompletedMonth\(/);
  assert.match(accounting, /const recorded=new Set\(periodEntries\.map\(e=>String\(e\.depreciationPeriod\)\)\)/);
  assert.match(accounting, /if\(!recorded\.has\(cursor\)\)periods\.push\(cursor\)/);
  assert.match(accounting, /asset\.monthsDepreciated=count/);
  assert.match(accounting, /assetId:asset\.id,depreciationPeriod:month/);
  assert.match(accounting, /availableForUseDate\|\|asset\.acquisitionDate/);
  assert.doesNotMatch(accounting, /prompt\('Indique el período hasta el cual desea depreciar/);
  assert.doesNotMatch(accounting, /data-depreciate=/);
});
