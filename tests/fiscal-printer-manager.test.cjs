'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manager = require('../electron/fiscal-printer-manager.cjs');

test('registra las familias fiscales solicitadas y sus SDK esperados', () => {
  for (const id of ['hka','bematech','epson','quorion','aclas','pnp']) {
    assert.ok(manager.PROVIDERS[id], 'Falta proveedor ' + id);
    assert.ok(manager.PROVIDERS[id].sdkFiles.length > 0);
  }
  assert.deepEqual(manager.USB_SERIAL_DRIVERS.map(x => x.id), ['prolific','ftdi','silabs']);
});

test('normaliza configuración COM y parámetros seriales', () => {
  const p = manager.normalizeProfile({provider:'hka',model:'HKA80',port:'com7',baudRate:9600,dataBits:8,parity:'none',stopBits:1});
  assert.equal(p.port, 'COM7');
  assert.equal(p.provider, 'hka');
  assert.equal(p.baudRate, 9600);
});

test('rechaza puertos COM y protocolos seriales inválidos', () => {
  assert.throws(() => manager.normalizeProfile({provider:'hka',port:'COM0'}), /COM1/);
  assert.throws(() => manager.normalizeProfile({provider:'hka',port:'COM7',baudRate:123}), /Velocidad/);
  assert.throws(() => manager.normalizeProfile({provider:'hka',parity:'invalid'}), /Paridad/);
  assert.throws(() => manager.normalizeProfile({provider:'unknown'}), /Fabricante/);
});

test('informa qué SDK está presente sin fingir que el adaptador está listo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-fiscal-'));
  try {
    const dll = path.join(dir, 'TfhkaNet.dll');
    fs.writeFileSync(dll, 'fixture');
    const status = manager.getSdkStatus({provider:'hka',port:'COM4',sdkPaths:{'TfhkaNet.dll':dll}});
    assert.equal(status.files.find(x => x.filename === 'TfhkaNet.dll').exists, true);
    assert.equal(status.bridgeExists, false);
    assert.equal(status.ready, false);
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
});

test('la emisión exige clave idempotente y puente autorizado', async () => {
  await assert.rejects(() => manager.emitInvoice(
    {provider:'hka',port:'COM4'},
    {total:10}
  ), /idempotencia/);
  await assert.rejects(() => manager.emitInvoice(
    {provider:'hka',port:'COM4'},
    {idempotencyKey:'sale-01',total:10}
  ), /puente fiscal/);
});

test('la detección de puertos no Windows no inventa dispositivos', async () => {
  const result = await manager.listSerialPorts({platform:'linux'});
  assert.equal(result.supported, false);
  assert.deepEqual(result.ports, []);
});
