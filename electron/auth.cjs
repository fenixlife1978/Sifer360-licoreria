'use strict';

const crypto = require('node:crypto');

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new Error('La contraseña debe tener entre 10 y 128 caracteres.');
  }
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'base64url');
  if (saltBuffer.length < 16 || saltBuffer.length > 64) throw new Error('Sal criptográfica no válida.');
  const derived = crypto.scryptSync(password, saltBuffer, SCRYPT.keyLength, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, saltBuffer.toString('base64url'), derived.toString('base64url')].join('$');
}

function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128 || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (n !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch { return false; }
  if (salt.length < 16 || salt.length > 64 || expected.length !== SCRYPT.keyLength) return false;
  try {
    const actual = crypto.scryptSync(password, salt, SCRYPT.keyLength, SCRYPT);
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function createAuthSessionManager({ now = () => Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  const sessions = new Map();
  function create(senderId, user) {
    if (!Number.isSafeInteger(senderId) || senderId < 1) throw new Error('Ventana de sesión no válida.');
    if (!user || !user.id || !user.username || !['admin', 'cajero', 'contador'].includes(user.role)) {
      throw new Error('Identidad de usuario no válida.');
    }
    revokeSender(senderId);
    const token = crypto.randomBytes(32).toString('base64url');
    const session = Object.freeze({
      token, senderId, userId: String(user.id), username: String(user.username),
      name: String(user.name || user.username), role: user.role,
      cashbox: String(user.cashbox || '—'), createdAt: now(), expiresAt: now() + ttlMs
    });
    sessions.set(token, session);
    return { token, user: { id: session.userId, username: session.username, name: session.name, role: session.role, cashbox: session.cashbox }, expiresAt: session.expiresAt };
  }
  function get(senderId, token) {
    if (!Number.isSafeInteger(senderId) || typeof token !== 'string') return null;
    const session = sessions.get(token);
    if (!session || session.senderId !== senderId) return null;
    if (session.expiresAt <= now()) { sessions.delete(token); return null; }
    return { id: session.userId, username: session.username, name: session.name, role: session.role, cashbox: session.cashbox };
  }
  function revoke(senderId, token) {
    const session = sessions.get(token);
    if (session && session.senderId === senderId) sessions.delete(token);
  }
  function revokeSender(senderId) {
    for (const [token, session] of sessions) if (session.senderId === senderId) sessions.delete(token);
  }
  function revokeAll() { sessions.clear(); }
  return Object.freeze({ create, get, revoke, revokeSender, revokeAll });
}

module.exports = { hashPassword, verifyPassword, createAuthSessionManager, SESSION_TTL_MS };
