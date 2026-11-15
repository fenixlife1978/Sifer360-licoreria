'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pnp = require('../electron/pnp-protocol.cjs');

test('codifica una trama PNP con STX, secuencia, comando, campos, ETX y BCC', () => {
  const frame = pnp.encodeCommand(0x38, ['N'], 0x21);
  assert.deepEqual([...frame.subarray(0, 5)], [0x02, 0x21, 0x38, 0x1c, 0x4e]);
  assert.equal(frame[5], 0x03);
  assert.match(frame.subarray(6).toString('ascii'), /^[0-9A-F]{4}$/);
  assert.equal(pnp.decodeFrame(frame).sequence, 0x21);
});

test('crea la consulta de estado PNP sin ejecutar un reporte fiscal', () => {
  const frame = pnp.createStatusQuery(0x22);
  const response = pnp.decodeFrame(frame);
  assert.equal(response.command, 0x38);
  assert.deepEqual(response.fields, ['N']);
});

test('decodifica respuesta, separadores y estados', () => {
  const responseFrame = pnp.encodeCommand(0x38, ['0000', '0000', '34', '0', '56', '260101', '120000', '7', '0', '7', '0', '3'], 0x23);
  const response = pnp.decodeFrame(responseFrame);
  assert.equal(response.sequence, 0x23);
  assert.equal(response.command, 0x38);
  assert.equal(response.fields[0], '0000');
  assert.equal(response.fields[1], '0000');
  assert.equal(pnp.validateResponse(response, {sequence:0x23,command:0x38}), response);
});

test('rechaza BCC manipulado, secuencia y respuesta de otro comando', () => {
  const frame = pnp.encodeCommand(0x38, ['N'], 0x24);
  const corrupt = Buffer.from(frame);
  corrupt[4] ^= 1;
  assert.throws(() => pnp.decodeFrame(corrupt), /BCC/);
  assert.throws(() => pnp.encodeCommand(0x38, ['N'], 0x1f), /secuencia/);
  assert.throws(() => pnp.validateResponse(pnp.decodeFrame(frame), {command:0x45}), /comando/);
});

test('no permite campos que inyecten separadores o control del protocolo', () => {
  assert.throws(() => pnp.encodeCommand(0x40, ['Cliente\x1cOtro']), /caracteres de control/);
  assert.throws(() => pnp.encodeCommand(0x40, ['Cliente\n']), /caracteres de control/);
});

test('detecta respuestas negativas de la impresora', () => {
  const response = pnp.decodeFrame(pnp.encodeCommand(0x40, ['0000','0000','12','ERROR12'], 0x25));
  assert.throws(() => pnp.validateResponse(response), /rechazó el comando/);
});

test('construye comandos de factura fiscal PNP v5.4 con campos y límites documentados', () => {
  const open = pnp.decodeFrame(pnp.createFiscalOpenInvoice({customerName:'Cliente de prueba',customerRif:'J-12345678-9'},0x26));
  assert.equal(open.command,0x40);
  assert.deepEqual(open.fields,['Cliente de prueba','J-12345678-9','','','','','','','']);

  const text = pnp.decodeFrame(pnp.createFiscalText({text:'Detalle de prueba'},0x27));
  assert.equal(text.command,0x41);
  assert.deepEqual(text.fields,['Detalle de prueba','']);

  const item = pnp.decodeFrame(pnp.createFiscalItem({description:'Producto prueba',quantity:'2.000',amount:'15.50',taxRate:'1600',qualifier:'M'},0x28));
  assert.equal(item.command,0x42);
  assert.deepEqual(item.fields,['Producto prueba','2.000','15.50','1600','M','','','']);

  const subtotal = pnp.decodeFrame(pnp.createFiscalSubtotal(0x29));
  assert.equal(subtotal.command,0x43);
  assert.deepEqual(subtotal.fields,['','']);

  const close = pnp.decodeFrame(pnp.createFiscalCloseInvoice({mode:'U',foreignCurrencyAmount:'10.00'},0x2a));
  assert.equal(close.command,0x45);
  assert.deepEqual(close.fields,['U','10.00']);
});

test('rechaza datos fiscales PNP que exceden campos o formatos del protocolo', () => {
  assert.throws(() => pnp.createFiscalOpenInvoice({customerName:'X'.repeat(39)}), /máximo de 38/);
  assert.throws(() => pnp.createFiscalText({text:'X'.repeat(41)}), /máximo de 40/);
  assert.throws(() => pnp.createFiscalItem({description:'X'.repeat(21),quantity:'1.000',amount:'1.00',taxRate:'1600'}), /máximo de 20/);
  assert.throws(() => pnp.createFiscalItem({description:'Item',quantity:'1',amount:'1.00',taxRate:'1600'}), /formato numérico/);
  assert.throws(() => pnp.createFiscalItem({description:'Item',quantity:'1.000',amount:'1.0',taxRate:'1600'}), /formato numérico/);
  assert.throws(() => pnp.createFiscalCloseInvoice({mode:'U',foreignCurrencyAmount:'1'}), /formato numérico/);
  assert.throws(() => pnp.createFiscalCloseInvoice({mode:'T',foreignCurrencyAmount:'1.00'}), /solo aplica/);
});
