import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const activePayDlg = pos.slice(pos.lastIndexOf('function payDlg('));
const activeCasheaAssistant = pos.slice(pos.lastIndexOf('function casheaPaymentAssistantDlg('), pos.lastIndexOf('function casheaSimulatorDlg('));

test('la calculadora POS solo muestra campo de aprobación para CASHEA', () => {
  assert.match(activePayDlg, /const hasRef=m\.id==='cashea'/);
  assert.doesNotMatch(activePayDlg, /hasRef=\['biopago','punto','pmovil','transf','zelle','cashea'\]/);
  assert.match(activePayDlg, /<th>Aprobación CASHEA<\/th>/);
});

test('los medios de pago ordinarios no bloquean el cobro por falta de referencia', () => {
  assert.match(activePayDlg, /const refPrompts=\{cashea:'código real de aprobación de Cashea'\}/);
  assert.doesNotMatch(activePayDlg, /refPrompts=\{zelle:/);
  assert.match(activePayDlg, /ref:\(refs&&refs\[m\.id\]\)\|\|''/);
});

test('CASHEA conserva la exigencia de token real y no admite referencias inventadas', () => {
  assert.match(activeCasheaAssistant, /if\(!token\).*Ingrese el código de aprobación o token de Cashea/);
  assert.match(activePayDlg, /if\(!casheaRef\)\{msg\('Falta el código real de aprobación Cashea; no se generará una referencia ficticia\.'/);
  assert.match(activePayDlg, /if\(enteredAmts\.cashea>0&&el\._casheaTx/);
});

test('la inicial CASHEA no exige referencias bancarias para sus métodos de cobro ordinarios', () => {
  assert.doesNotMatch(activeCasheaAssistant, /cshInitRef/);
  assert.doesNotMatch(activeCasheaAssistant, /initialNeedsRef\.has/);
  assert.match(activeCasheaAssistant, /initialPayments\.push\(\{id:m\.id,name:m\.name,cur:m\.cur,amount,ref\}\)/);
});

test('los registros de pagos CxC y CxP no inventan referencias cuando el usuario las deja vacías', () => {
  assert.match(pos, /ref:\$\('#abRef',el\)\.value\.trim\(\),/);
  assert.match(pos, /ref:\$\('#pgRef',el\)\.value\.trim\(\),/);
  assert.doesNotMatch(pos, /\|\|'REC-'\+pad/);
  assert.doesNotMatch(pos, /\|\|'OP-'\+pad/);
  assert.doesNotMatch(pos, /\|\|'MIX-'\+pad/);
  assert.doesNotMatch(pos, /\|\|'OPM-'\+pad/);
});
