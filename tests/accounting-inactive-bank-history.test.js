import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/accounting.js', import.meta.url), 'utf8');

function bodyOf(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Debe existir ' + name);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('desactivar un banco no elimina sus auxiliares del historial contable', () => {
  assert.match(source, /function allMovementAccounts\(\)\{return state\(\)\.accounts\.filter\(x=>x\.isMovement\);\}/);
  assert.match(source, /function movementAccounts\(\)\{[\s\S]*?return allMovementAccounts\(\)\.filter\(x=>!x\.bankId\|\|activeBanks\.has\(String\(x\.bankId\)\)\);\}/);
});

test('libro mayor, balance, flujo y estados incluyen bancos inactivos con historia', () => {
  for (const name of ['renderLedger', 'renderTrial', 'exportTrial', 'cashFlowTotals', 'renderStatements', 'exportStatement']) {
    assert.match(bodyOf(name), /allMovementAccounts\(\)/, name + ' debe incluir auxiliares inactivos para consulta histórica');
  }
});

test('los nuevos movimientos y las asignaciones POS siguen excluyendo bancos inactivos', () => {
  assert.match(bodyOf('accountSelect'), /movementAccounts\(\)/);
  assert.match(bodyOf('renderIntegration'), /movementAccounts\(\)/);
});
