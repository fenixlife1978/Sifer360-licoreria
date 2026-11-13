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
  assert.match(accounting, /function depreciateAsset\(id\)/);
  assert.match(accounting, /depreciationPeriod:month/);
  assert.match(accounting, /lastDepreciationMonth/);
  assert.match(accounting, /asset\.monthsDepreciated=months\+1/);
});

test('el módulo impide depreciar dos veces un período', () => {
  assert.match(accounting, /month<=asset\.lastDepreciationMonth/);
});
