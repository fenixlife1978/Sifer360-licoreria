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
