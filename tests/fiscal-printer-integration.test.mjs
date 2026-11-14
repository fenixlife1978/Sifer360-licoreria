import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

test('la configuración fiscal se guarda por caja dentro del estado SQLite', () => {
  assert.match(main, /fiscalPrinters\[box\]=p/);
  assert.match(main, /fiscalPrinterJobs:S\.fiscalPrinterJobs/);
  assert.match(main, /fiscalPrinterJobs=d\.fiscalPrinterJobs/);
});

test('la modalidad máquina fiscal falla de forma segura si no hay adaptador listo', () => {
  assert.match(main, /fiscalMode=S\.cfg\.fiscalTipo==='MAQUINA_FISCAL'/);
  assert.match(main, /if\(!diagnostic\.ready\)/);
  assert.match(main, /fiscalPrinterTestBridge\(fiscalProfile\)/);
  assert.match(main, /La venta quedó sin confirmar en el POS/);
});

test('la intención de emisión se persiste antes de llamar al dispositivo', () => {
  const journalAt = main.indexOf("const journal=await save();", main.indexOf('let fiscalJob=null'));
  const emitAt = main.indexOf('fiscalPrinterEmitInvoice(fiscalProfile,fiscalInvoice)', journalAt);
  assert.ok(journalAt >= 0 && emitAt > journalAt);
  assert.match(main, /idempotencyKey/);
  assert.match(main, /status='pending'/);
});

test('no permite anular localmente una factura que ya emitió una máquina fiscal', () => {
  assert.match(main, /s\.fiscal\)\{msg\('Esta factura ya fue emitida por una máquina fiscal/);
});

test('Electron expone las acciones fiscales solo mediante IPC del proceso principal', () => {
  for (const method of ['fiscalPrinterListPorts','fiscalPrinterSelectFile','fiscalPrinterStatus','fiscalPrinterTestPort','fiscalPrinterTestBridge','fiscalPrinterEmitInvoice']) {
    assert.ok(preload.includes(method), 'Falta método preload: ' + method);
  }
  assert.match(electronMain, /FiscalPrinterManager\.emitInvoice/);
  assert.match(electronMain, /FiscalPrinterManager\.testSerialPort/);
});
