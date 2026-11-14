'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordHash, verifyPassword, normalizeLegacyUser, publicUser } = require('../electron/auth-credentials.cjs');

test('scrypt hashes are salted, verifiable and never expose the original password', async () => {
  const first = await createPasswordHash('ClaveSegura-123');
  const second = await createPasswordHash('ClaveSegura-123');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt-v1\$/);
  assert.equal(await verifyPassword('ClaveSegura-123', first), true);
  assert.equal(await verifyPassword('incorrecta', first), false);
  assert.equal(first.includes('ClaveSegura-123'), false);
});

test('credential verification rejects malformed or unsupported hashes', async () => {
  assert.equal(await verifyPassword('x', 'plain$x'), false);
  assert.equal(await verifyPassword('x', 'pbkdf2$a$b'), false);
  assert.equal(await verifyPassword(null, 'scrypt-v1$a$b'), false);
});

test('legacy user normalization validates and preserves account fields for migration', () => {
  const user = normalizeLegacyUser({ username: 'caja_01', name: 'Caja Uno', role: 'cajero', cashbox: '01', code: 'legacy-secret' });
  assert.deepEqual(user, { username: 'caja_01', name: 'Caja Uno', role: 'cajero', cashbox: '01', password: 'legacy-secret' });
  assert.deepEqual(publicUser(user), { username: 'caja_01', name: 'Caja Uno', role: 'cajero', cashbox: '01' });
  assert.equal(Object.hasOwn(publicUser(user), 'password'), false);
});

test('legacy user normalization rejects unknown roles and missing credentials', () => {
  assert.throws(() => normalizeLegacyUser({ username: 'x', role: 'root', code: 'secret' }), /Rol heredado/);
  assert.throws(() => normalizeLegacyUser({ username: 'x', role: 'admin' }), /credencial/);
  assert.throws(() => normalizeLegacyUser({ username: '../x', role: 'admin', code: 'secret' }), /Nombre de usuario/);
});
