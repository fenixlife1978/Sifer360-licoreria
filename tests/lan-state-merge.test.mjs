import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeStateRecords } = require('../electron/lan-state-merge.cjs');

test('la fusión conserva registros de la misma numeración cuando pertenecen a cajas diferentes', () => {
  const merged = mergeStateRecords(
    { sales: [{ id: 'V-0001', cashbox: '01', total: 10 }] },
    { sales: [{ id: 'V-0001', cashbox: '02', total: 20 }] }
  );
  assert.equal(merged.sales.length, 2);
  assert.deepEqual(merged.sales.map(item => item.cashbox).sort(), ['01', '02']);
});

test('para la misma entidad y caja prevalece la versión con fecha ISO más reciente', () => {
  const merged = mergeStateRecords(
    { sales: [{ id: 'V-0001', cashbox: '01', total: 10, updatedAt: '2026-11-14T10:00:00.000Z' }] },
    { sales: [{ id: 'V-0001', cashbox: '01', total: 25, updatedAt: '2026-11-14T12:00:00.000Z' }] }
  );
  assert.equal(merged.sales.length, 1);
  assert.equal(merged.sales[0].total, 25);
});

test('una versión atrasada no reemplaza una operación más reciente', () => {
  const merged = mergeStateRecords(
    { sales: [{ id: 'V-0001', cashbox: '01', total: 25, updatedAt: '2026-11-14T12:00:00.000Z' }] },
    { sales: [{ id: 'V-0001', cashbox: '01', total: 10, updatedAt: '2026-11-14T10:00:00.000Z' }] }
  );
  assert.equal(merged.sales[0].total, 25);
});

test('las liquidaciones CASHEA y los cambios de divisas se fusionan sin reemplazar arrays completos', () => {
  const merged = mergeStateRecords(
    { casheaLiquidaciones: [{ id: 'L-1', cashbox: '01' }], cambiosDivisas: [{ id: 'C-1', cashbox: '01' }] },
    { casheaLiquidaciones: [{ id: 'L-2', cashbox: '02' }], cambiosDivisas: [{ id: 'C-2', cashbox: '02' }] }
  );
  assert.equal(merged.casheaLiquidaciones.length, 2);
  assert.equal(merged.cambiosDivisas.length, 2);
});

test('los registros sin identificador se deduplican por contenido y los campos simples toman el snapshot entrante', () => {
  const merged = mergeStateRecords(
    { products: [{ name: 'Producto sin SKU', price: 10 }], cfg: { currency: 'USD', note: 'old' } },
    { products: [{ name: 'Producto sin SKU', price: 10 }], cfg: { currency: 'VES', note: 'new' } }
  );
  assert.equal(merged.products.length, 1);
  assert.deepEqual(merged.cfg, { currency: 'VES', note: 'new' });
});

test('fusiona movimientos de caja y auditorías de tasa por identificador y caja sin reemplazar el historial', () => {
  const merged = mergeStateRecords(
    { movimientosCaja:[{id:'MOV-1',cashbox:'01',amount:10}], rateAudit:[{id:'RATE-1',cashbox:'01',newRate:800}], fiscalBankOperations:[{id:'BANK-1',amount:5}] },
    { movimientosCaja:[{id:'MOV-2',cashbox:'02',amount:20}], rateAudit:[{id:'RATE-2',cashbox:'02',newRate:900}], fiscalBankOperations:[{id:'BANK-2',amount:15}] }
  );
  assert.deepEqual(merged.movimientosCaja.map(x=>x.id).sort(), ['MOV-1','MOV-2']);
  assert.deepEqual(merged.rateAudit.map(x=>x.id).sort(), ['RATE-1','RATE-2']);
  assert.deepEqual(merged.fiscalBankOperations.map(x=>x.id).sort(), ['BANK-1','BANK-2']);
});

test('las eliminaciones de borradores y documentos se respetan en el snapshot autoritativo', () => {
  const merged = mergeStateRecords(
    { held:[{id:'HELD-1'}], documents:[{id:'DOC-1'}] },
    { held:[], documents:[] }
  );
  assert.deepEqual(merged.held, []);
  assert.deepEqual(merged.documents, []);
});
