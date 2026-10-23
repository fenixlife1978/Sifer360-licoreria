import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
  const document = { addEventListener() {}, querySelector() { return null; }, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; }, head: { appendChild() {} } };
  const window = {};
  const context = { window, document, console, Intl, Date, Math, Number, String, Array, Object, Map, JSON, Blob: class Blob {}, URL: {}, alert() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sicoven.js', import.meta.url), 'utf8'), context);
  return window.SIFERSicoven;
}

const csv = [
  'fecha;cuenta;direccion;moneda;monto;referencia;descripcion',
  '2026-10-01;1.1.1.06;IN;Bs;1250,50;REF123;Abono recibido',
  '2026-10-02;1.1.1.07;OUT;USD;20.00;REF124;Cargo bancario'
].join('\n');

test('el importador CSV acepta movimientos en Bs y USD y conserva la referencia', () => {
  const accounting = load();
  const parsed = accounting.parseBankStatementCSV(csv);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].currency, 'Bs');
  assert.equal(parsed.rows[0].amount, 1250.5);
  assert.equal(parsed.rows[1].currency, 'USD');
  assert.equal(parsed.rows[1].direction, 'OUT');
  assert.equal(parsed.rows[0].reference, 'REF123');
});

test('los movimientos importados sin coincidencia quedan pendientes de conciliación y revisión fiscal', () => {
  const accounting = load();
  const s = { cfg: { rate: 40 }, sicoven: { config: {}, entries: [], errors: [], bankMovements: [] } };
  const result = accounting.importBankStatementCSV(csv, s);
  assert.equal(result.imported, 2);
  assert.equal(result.matched, 0);
  assert.equal(s.sicoven.bankMovements.length, 2);
  assert.ok(s.sicoven.bankMovements.every(m => m.status === 'PENDIENTE'));
  assert.ok(s.sicoven.bankMovements.every(m => m.fiscalStatus === 'PENDIENTE_REVISION'));
  assert.equal(s.sicoven.bankMovements[0].source, 'ESTADO_CUENTA');
});

test('la importación es idempotente y no duplica movimientos ya cargados', () => {
  const accounting = load();
  const s = { cfg: { rate: 40 }, sicoven: { config: {}, entries: [], errors: [], bankMovements: [] } };
  const first = accounting.importBankStatementCSV(csv, s);
  const second = accounting.importBankStatementCSV(csv, s);
  assert.equal(first.imported, 2);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(s.sicoven.bankMovements.length, 2);
});

test('rechaza CSV sin encabezados bancarios requeridos', () => {
  const accounting = load();
  const result = accounting.parseBankStatementCSV('fecha,monto\n2026-10-01,10');
  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join(' '), /Faltan columnas requeridas/);
});
