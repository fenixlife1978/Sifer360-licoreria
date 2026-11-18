'use strict';

function isSafeAutomationPath(path) {
  return typeof path === 'string' &&
    /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,5}$/.test(path) &&
    !path.split('.').some(part => ['__proto__','prototype','constructor'].includes(part));
}

function extractAutomationValue(record, path) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  if (!isSafeAutomationPath(path)) throw new Error('La ruta del dato contable no es válida.');
  const parts = path.split('.');
  let value = record;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = value[part];
  }
  if (value && typeof value === 'object') throw new Error('La ruta configurada debe apuntar a un importe o código simple, no a un objeto.');
  return value;
}

module.exports = { extractAutomationValue, isSafeAutomationPath };
