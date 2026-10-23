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

test('la conciliación automática solo marca una coincidencia única por fecha, cuenta, dirección e importe', () => {
  const accounting = load();
  const s = {
    cfg: { rate: 40 },
    sicoven: { config: {}, bankMovements: [], errors: [], entries: [{
      id: 'SIC-FAC-01-VENTA', date: '2026-10-01', reference: 'FAC-01',
      description: 'Cobro POS', rate: 40,
      lines: [{ accountCode: '1.1.1.06', debitUsd: 31.2625, creditUsd: 0, debitBs: 1250.5, creditBs: 0 }]
    }] }
  };
  const result = accounting.importBankStatementCSV([
    'fecha;cuenta;direccion;moneda;monto;referencia;descripcion',
    '2026-10-01;1.1.1.06;IN;Bs;1250,50;REF-EXT;Abono recibido'
  ].join('\n'), s);
  assert.equal(result.imported, 1);
  assert.equal(result.matched, 1, JSON.stringify({ result, movement: s.sicoven.bankMovements[0] }));
  assert.equal(s.sicoven.bankMovements[0].status, 'CONCILIADO');
  assert.equal(s.sicoven.bankMovements[0].autoMatched, true);
});

test('crear asiento bancario exige clasificación fiscal explícita y genera doble partida balanceada', () => {
  const accounting = load();
  const s = { cfg: { rate: 40 }, sicoven: { config: {}, entries: [], errors: [], bankMovements: [] } };
  const movement = { id: 'BANK-TEST-1', date: '2026-10-01', accountCode: '1.1.1.06', direction: 'OUT', currency: 'USD', amount: 20, rate: 40, reference: 'FEE-1', description: 'Comisión bancaria', status: 'PENDIENTE' };
  const missingFiscal = accounting.createBankMovementEntry(s, movement, '6.1.1.07', '', '');
  assert.match(missingFiscal.error, /Clasifique el tratamiento fiscal/);
  const created = accounting.createBankMovementEntry(s, movement, '6.1.1.07', 'NO_APLICA', '', 'Comisión bancaria según estado de cuenta');
  assert.ok(created.entry);
  assert.equal(created.entry.lines.length, 2);
  assert.equal(created.entry.lines[0].accountCode, '1.1.1.06');
  assert.equal(created.entry.lines[0].debitUsd, 0);
  assert.equal(created.entry.lines[0].creditUsd, 20);
  assert.equal(created.entry.lines[1].debitUsd, 20);
  assert.equal(created.entry.totals.debitUsd, created.entry.totals.creditUsd);
  assert.equal(movement.status, 'CONCILIADO');
  assert.equal(movement.fiscalStatus, 'NO_APLICA');
  const duplicate = accounting.createBankMovementEntry(s, movement, '6.1.1.07', 'NO_APLICA', '');
  assert.match(duplicate.error, /ya está conciliado/);
});

test('un documento fiscal vinculado debe existir en los registros locales', () => {
  const accounting = load();
  const s = { cfg: { rate: 40 }, sicoven: { config: {}, entries: [], errors: [], bankMovements: [] }, sales: [], purchases: [] };
  const movement = { id: 'BANK-TEST-2', date: '2026-10-01', accountCode: '1.1.1.06', direction: 'IN', currency: 'USD', amount: 100, rate: 40, reference: 'REF', description: 'Depósito', status: 'PENDIENTE' };
  const result = accounting.createBankMovementEntry(s, movement, '4.1.1.01', 'DOCUMENTO_VINCULADO', 'FAC-00000099');
  assert.match(result.error, /No se encontró ese documento/);
  assert.equal(s.sicoven.entries.length, 0);
});

test('las operaciones no gravables quedan enlazadas entre Sicoven y el módulo Fiscal sin sumarse al libro de ventas', () => {
  const accounting = load();
  const s = { cfg: { rate: 40 }, sicoven: { config: {}, entries: [], errors: [], bankMovements: [] } };
  const movement = { id: 'BANK-FISC-1', date: '2026-10-01', accountCode: '1.1.1.06', direction: 'OUT', currency: 'USD', amount: 20, rate: 40, reference: 'FEE-1', description: 'Comisión bancaria', status: 'PENDIENTE' };
  const result = accounting.createBankMovementEntry(s, movement, '6.1.1.07', 'NO_APLICA', '');
  assert.ok(result.entry);
  assert.equal(s.fiscalBankOperations.length, 1);
  assert.equal(s.fiscalBankOperations[0].taxable, false);
  assert.match(s.fiscalBankOperations[0].fiscalReason, /Comisión bancaria/);
  assert.equal(s.fiscalBankOperations[0].accountingEntryId, result.entry.id);
  const fiscal = fs.readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
  assert.match(fiscal, /data-tab="bancarias">Operaciones no gravables/);
  assert.match(fiscal, /S\.fiscalBankOperations/);
  assert.match(fiscal, /no se incorporan al Libro de Ventas ni al Libro de Compras/);
});
