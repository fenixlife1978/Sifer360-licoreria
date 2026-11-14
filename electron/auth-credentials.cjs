'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function createPasswordHash(password) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) {
    throw new Error('La contraseña debe contener entre 1 y 1024 caracteres.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return ['scrypt-v1', salt.toString('base64'), Buffer.from(derived).toString('base64')].join('$');
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt-v1') return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[1], 'base64');
    expected = Buffer.from(parts[2], 'base64');
  } catch { return false; }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = Buffer.from(await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS));
  return crypto.timingSafeEqual(actual, expected);
}

function normalizeLegacyUser(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('Registro de usuario heredado inválido.');
  const username = String(user.username || '').trim();
  const name = String(user.name || username).trim();
  const role = String(user.role || '').trim().toLowerCase();
  const cashbox = String(user.cashbox || '—').trim();
  const password = typeof user.code === 'string' ? user.code : '';
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error('Nombre de usuario heredado inválido.');
  if (!name || name.length > 120) throw new Error('Nombre de usuario heredado inválido.');
  if (!['admin', 'cajero', 'contador'].includes(role)) throw new Error('Rol heredado no reconocido para ' + username + '.');
  if (!password || password.length > 1024) throw new Error('No se puede migrar la credencial heredada de ' + username + '.');
  if (cashbox.length > 40) throw new Error('Caja heredada inválida para ' + username + '.');
  return { username, name, role, cashbox, password };
}

function publicUser(user) {
  if (!user) return null;
  return { username: user.username, name: user.name, role: user.role, cashbox: user.cashbox };
}

module.exports = { createPasswordHash, verifyPassword, normalizeLegacyUser, publicUser };
