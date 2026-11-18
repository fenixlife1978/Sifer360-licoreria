'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountingSessionGuard } = require('../electron/accounting-auth.cjs');

function fixture({ role = 'contador', active = 1, expiresAt = 5000, now = 1000 } = {}) {
  const sessions = new Map([['valid-token', {
    user: { username: 'conta', name: 'Contador', role: 'admin', cashbox: 'Caja 1' },
    expiresAt
  }]]);
  const guard = createAccountingSessionGuard({
    sessions,
    now: () => now,
    findActiveUser: username => username.toLowerCase() === 'conta'
      ? { username: 'conta', name: 'Contador vigente', role, cashbox: 'Caja 2', active }
      : null
  });
  return { sessions, guard };
}

test('rechaza token ausente o malformado', () => {
  const { guard } = fixture();
  assert.throws(() => guard(''), /sesión autenticada/);
  assert.throws(() => guard(null), /sesión autenticada/);
  assert.throws(() => guard('x'.repeat(257)), /sesión autenticada/);
});

test('rechaza y revoca una sesión vencida', () => {
  const { sessions, guard } = fixture({ expiresAt: 999 });
  assert.throws(() => guard('valid-token'), /expiró/);
  assert.equal(sessions.has('valid-token'), false);
});

test('revoca sesiones cuando el usuario ya no existe o está inactivo', () => {
  const sessions = new Map([
    ['one', { user: { username: 'conta' }, expiresAt: 5000 }],
    ['two', { user: { username: 'CONTA' }, expiresAt: 5000 }]
  ]);
  const guard = createAccountingSessionGuard({ sessions, now: () => 1000, findActiveUser: () => null });
  assert.throws(() => guard('one'), /ya no está activo/);
  assert.equal(sessions.size, 0);
});

test('el rol se obtiene de SQLite y no del rol antiguo de la sesión', () => {
  const { sessions, guard } = fixture({ role: 'cajero' });
  assert.throws(() => guard('valid-token'), /no está autorizado/);
  assert.equal(sessions.get('valid-token').user.role, 'cajero');
});

test('admin y contador autorizados producen actor autenticado', () => {
  for (const role of ['admin', 'contador']) {
    const { guard } = fixture({ role });
    const actor = guard('valid-token');
    assert.equal(actor.actorId, 'conta');
    assert.equal(actor.actorRole, role);
    assert.equal(actor.name, 'Contador vigente');
    assert.equal(actor.cashbox, 'Caja 2');
  }
});

test('no acepta identidad o rol alternativo enviado por el renderer', () => {
  const { guard } = fixture({ role: 'contador' });
  const actor = guard('valid-token');
  assert.equal(actor.actorId, 'conta');
  assert.equal(actor.actorRole, 'contador');
  assert.equal(Object.hasOwn(actor, 'requestedActorId'), false);
});

test('permite declarar roles explícitos por operación', () => {
  const { guard } = fixture({ role: 'admin' });
  assert.equal(guard('valid-token', { allowedRoles: ['admin'] }).actorRole, 'admin');
  assert.throws(() => guard('valid-token', { allowedRoles: ['contador'] }), /no está autorizado/);
});
