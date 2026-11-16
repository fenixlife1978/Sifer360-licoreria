'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manager = require('../electron/printer-manager.cjs');

test('normaliza nombre de impresora y rechaza valores vacíos o con saltos', () => {
  assert.equal(manager.normalizePrinterName('  POS-80  '), 'POS-80');
  assert.throws(() => manager.normalizePrinterName(''), /impresora/);
  assert.throws(() => manager.normalizePrinterName('POS\nFake'), /impresora/);
});
test('genera flujo ESC/POS con inicialización, texto y corte', () => {
  const payload = manager.buildEscPosPayload('SIFER360\n¡Gracias!\nTotal: 10,00');
  assert.equal(payload[0], 0x1B);
  assert.equal(payload[1], 0x40);
  assert.ok(payload.includes(0x1D));
  assert.ok(payload.includes(0x56));
  assert.match(payload.toString('ascii'), /Gracias/);
  assert.match(payload.toString('ascii'), /Total: 10,00/);
});
test('limita ancho y elimina caracteres no representables sin romper el flujo', () => {
  const payload = manager.buildEscPosPayload('A'.repeat(80) + '\nCafé',{columns:48});
  assert.match(payload.toString('ascii'), /A{48}/);
  assert.match(payload.toString('ascii'), /Cafe/);
});
test('no inventa impresoras fuera de Windows', async () => {
  const result = await manager.listPrinters({platform:'linux'});
  assert.equal(result.supported,false);
  assert.deepEqual(result.printers,[]);
});
test('lista impresoras Windows usando la salida real del sistema', async () => {
  const result = await manager.listPrinters({platform:'win32',execFileAsync:async()=>({stdout:JSON.stringify([{Name:'POS-80',DriverName:'Generic / Text Only',PortName:'USB001',PrinterStatus:3,Shared:false}])})});
  assert.equal(result.printers.length,1);
  assert.equal(result.printers[0].name,'POS-80');
  assert.equal(result.printers[0].portName,'USB001');
});
test('envía un trabajo RAW y confirma bytes escritos', async () => {
  let argsSeen;
  const result = await manager.printRaw('POS-80',Buffer.from([0x1B,0x40,0x41]),{platform:'win32',execFileAsync:async(_cmd,args)=>{argsSeen=args;return{stdout:'OK:3'};}});
  assert.equal(result.ok,true);
  assert.equal(result.bytes,3);
  assert.ok(argsSeen[argsSeen.length-2]);
});
test('no informa éxito si Windows no confirma el envío completo', async () => {
  await assert.rejects(()=>manager.printRaw('POS-80',Buffer.from([1,2]),{platform:'win32',execFileAsync:async()=>({stdout:'OK:1'})}),/No se pudo enviar/);
});
