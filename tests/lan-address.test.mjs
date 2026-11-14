import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isLanAddress, assertLanHost } = require('../electron/lan-address.cjs');

test('acepta rangos IPv4 privados, loopback y link-local', () => {
  for (const address of ['10.0.0.1','172.16.0.1','172.31.255.255','192.168.1.1','127.0.0.1','169.254.10.2']) {
    assert.equal(isLanAddress(address), true, address);
  }
});

test('rechaza IPv4 pública, compartida, reservada, multicast y malformada', () => {
  for (const address of ['8.8.8.8','172.15.0.1','172.32.0.1','192.0.2.1','100.64.0.1','224.0.0.1','0.0.0.0','192.168.1.999','not-an-ip']) {
    assert.equal(isLanAddress(address), false, address);
  }
});

test('acepta IPv6 loopback, ULA y link-local dentro de sus prefijos exactos', () => {
  for (const address of ['::1','fc00::1','fd12:3456::1','fe80::1','febf::1','fe80::1%eth0']) {
    assert.equal(isLanAddress(address), true, address);
  }
});

test('rechaza IPv6 global, site-local obsoleto, unspecified y texto con prefijos falsos', () => {
  for (const address of ['2001:4860::1','fec0::1','::','fc:bad','fd.invalid','fe80evil::1']) {
    assert.equal(isLanAddress(address), false, address);
  }
});

test('normaliza IPv4 mapeada en IPv6 y aplica el mismo filtro privado', () => {
  assert.equal(isLanAddress('::ffff:192.168.1.20'), true);
  assert.equal(isLanAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLanAddress('::ffff:8.8.8.8'), false);
});

test('assertLanHost rechaza una dirección pública antes de cualquier solicitud HTTPS', () => {
  assert.equal(assertLanHost('192.168.0.25'), true);
  assert.throws(() => assertLanHost('8.8.8.8'), /No se enviaron credenciales/);
});
