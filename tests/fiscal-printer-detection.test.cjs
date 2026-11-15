const test = require('node:test');
const assert = require('node:assert/strict');
const FiscalPrinterManager = require('../electron/fiscal-printer-manager.cjs');

test('identifica VID/PID y recomienda el controlador USB-serial sin identificar la impresora fiscal', async () => {
  const result = await FiscalPrinterManager.listSerialPorts({
    platform: 'win32',
    execFileAsync: async () => ({
      stdout: JSON.stringify([{
        port: 'COM7',
        name: 'Prolific USB-to-Serial (COM7)',
        status: 'OK',
        instanceId: 'USB\\VID_067B&PID_2303\\ABC123'
      }])
    })
  });
  assert.equal(result.ports.length, 1);
  assert.equal(result.ports[0].port, 'COM7');
  assert.equal(result.ports[0].vendorId, '067B');
  assert.equal(result.ports[0].productId, '2303');
  assert.equal(result.ports[0].driverId, 'prolific');
  assert.match(result.ports[0].driverLabel, /Prolific/);
});

test('no atribuye fabricante fiscal cuando VID/PID no identifica chipset compatible', async () => {
  const result = await FiscalPrinterManager.listSerialPorts({
    platform: 'win32',
    execFileAsync: async () => ({
      stdout: JSON.stringify([{
        port: 'COM4',
        name: 'USB Serial Device (COM4)',
        status: 'OK',
        instanceId: 'USB\\VID_FFFF&PID_0001\\XYZ'
      }])
    })
  });
  assert.equal(result.ports[0].driverId, '');
  assert.equal(result.ports[0].vendorId, 'FFFF');
  assert.equal(result.ports[0].productId, '0001');
  assert.equal(result.ports[0].driverLabel, 'Controlador USB-Serial no identificado');
});

test('mantiene detección serial restringida a Windows', async () => {
  const result = await FiscalPrinterManager.listSerialPorts({ platform: 'linux' });
  assert.equal(result.supported, false);
  assert.deepEqual(result.ports, []);
});

test('no infiere chipset usando solamente el VID cuando el PID es desconocido', async () => {
  const result = await FiscalPrinterManager.listSerialPorts({
    platform: 'win32',
    execFileAsync: async () => ({
      stdout: JSON.stringify([{
        port: 'COM11',
        name: 'USB Serial Device (COM11)',
        status: 'OK',
        instanceId: 'USB\\\\VID_067B&PID_9999\\\\XYZ'
      }])
    })
  });
  assert.equal(result.ports[0].port, 'COM11');
  assert.equal(result.ports[0].vendorId, '067B');
  assert.equal(result.ports[0].productId, '9999');
  assert.equal(result.ports[0].driverId, '');
});

test('enumera puertos COM superiores a COM10 sin truncarlos', async () => {
  const result = await FiscalPrinterManager.listSerialPorts({
    platform: 'win32',
    execFileAsync: async () => ({
      stdout: JSON.stringify([
        { port: 'COM11', name: 'Serial Port (COM11)', status: 'OK', instanceId: '' },
        { port: 'COM27', name: 'Serial Port (COM27)', status: 'OK', instanceId: '' }
      ])
    })
  });
  assert.deepEqual(result.ports.map(port => port.port), ['COM11', 'COM27']);
});
