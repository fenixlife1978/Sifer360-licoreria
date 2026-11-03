'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, createAuthSessionManager, SESSION_TTL_MS } = require('../electron/auth.cjs');

test('password hashes are salted and never store the original password', () => {
  const first = hashPassword('ClaveSegura-2026!');
  const second = hashPassword('ClaveSegura-2026!');
  assert.notEqual(first, second);
  assert.equal(first.includes('ClaveSegura-2026!'), false);
  assert.equal(verifyPassword('ClaveSegura-2026!', first), true);
  assert.equal(verifyPassword('otra-clave-2026', first), false);
});

test('password policy rejects weak and malformed inputs', () => {
  assert.throws(() => hashPassword('corta'));
  assert.throws(() => hashPassword('x'.repeat(129)));
  assert.equal(verifyPassword('x', 'plaintext'), false);
  assert.equal(verifyPassword('x', 'scrypt$1$1$1$bad$bad'), false);
});

test('session is bound to the Electron sender and expires', () => {
  let time = 1000;
  const manager = createAuthSessionManager({ now: () => time, ttlMs: 5000 });
  const result = manager.create(7, { id: 'u1', username: 'admin', name: 'Admin', role: 'admin', cashbox: '—' });
  assert.equal(manager.get(7, result.token).username, 'admin');
  assert.equal(manager.get(8, result.token), null);
  time += 5000;
  assert.equal(manager.get(7, result.token), null);
});

test('new login replaces prior session for same sender; logout revokes it', () => {
  const manager = createAuthSessionManager();
  const first = manager.create(3, { id: 'u1', username: 'admin', role: 'admin' });
  const second = manager.create(3, { id: 'u2', username: 'contador', role: 'contador' });
  assert.equal(manager.get(3, first.token), null);
  assert.equal(manager.get(3, second.token).role, 'contador');
  manager.revoke(3, second.token);
  assert.equal(manager.get(3, second.token), null);
});
