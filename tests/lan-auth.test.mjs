import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hasValidBearerToken } = require('../electron/lan-auth.cjs');

test('acepta únicamente el bearer token exacto', () => {
  assert.equal(hasValidBearerToken('Bearer 0123456789abcdef', '0123456789abcdef'), true);
  assert.equal(hasValidBearerToken('bearer 0123456789abcdef', '0123456789abcdef'), false);
  assert.equal(hasValidBearerToken('Bearer 0123456789abcdef ', '0123456789abcdef'), false);
});

test('rechaza token ausente, vacío, malformado o de longitud distinta', () => {
  const token = '0123456789abcdef';
  for (const header of [undefined, null, '', 'Basic ' + token, 'Bearer', 'Bearer ' + token + 'x']) {
    assert.equal(hasValidBearerToken(header, token), false);
  }
  assert.equal(hasValidBearerToken('Bearer ' + token, ''), false);
  assert.equal(hasValidBearerToken('Bearer ' + token, null), false);
});

test('rechaza cualquier credencial equivocada sin filtrar comparaciones parciales', () => {
  const token = '0123456789abcdef';
  for (const candidate of ['0123456789abcdee', '1123456789abcdef', '0000000000000000']) {
    assert.equal(hasValidBearerToken('Bearer ' + candidate, token), false);
  }
});
