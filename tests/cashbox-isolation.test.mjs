import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');

test('las secuencias operativas se indexan por caja', () => {
  assert.match(main, /const box=currentCaja\(\),seqs=cajaSeqs\(\)/);
  assert.match(main, /seqs\[box\]\.invoice=no\+1/);
  const seq = { '01': { invoice: 1 }, '02': { invoice: 1 } };
  seq['01'].invoice += 1;
  assert.equal(seq['01'].invoice, 2);
  assert.equal(seq['02'].invoice, 1);
});

test('cada venta nueva queda identificada con caja y cajero', () => {
  assert.match(main, /ts,cashbox:currentCaja\(\),cashier:currentCajero\(\),client/);
  assert.match(main, /S\.sales\.filter\(s=>sameDay\(s\.ts\)&&s\.cashbox===currentCaja\(\)\)/);
});

test('CxC se consulta por caja y los cargos manuales también guardan caja', () => {
  assert.match(main, /all=\(S\.cxc\|\|\[\]\)\.filter\(x=>x\.cashbox===currentCaja\(\)\)/);
  assert.match(main, /cashbox:currentCaja\(\),cashier:currentCajero\(\),\s*total:amt/);
});

test('el corte Z se conserva en el estado persistente y en historial', () => {
  assert.match(main, /cortesZ:S\.cortesZ\|\|\[\]/);
  assert.match(main, /getZHistory\(\)\.push\(z\);\s*save\(\)/);
  assert.match(main, /data-z-print/);
});

test('el corte Z se calcula desde la apertura de jornada y por caja', () => {
  assert.match(main, /const shiftStart=\(\)=>active&&active\.openedAt/);
  assert.match(main, /Number\(s\.ts\)>=shiftStart\(\)/);
  assert.match(main, /String\(s\.cashbox\|\|box\)===box&&Number\(s\.ts\)>=shiftStart\(\)/);
});

test('la plantilla de impresión Z declara papel térmico de 80 mm y reporte no fiscal', () => {
  assert.match(main, /@page\{size:80mm auto;margin:3mm\}/);
  assert.match(main, /REPORTE DE CONTROL INTERNO · NO FISCAL/);
});

test('el corte Z requiere autorización y cierra la apertura activa', () => {
  assert.match(main, /requestPin\('Cerrar caja y generar Corte Z '\+box\)/);
  assert.match(main, /status:'cerrada',closedAt:z\.closedAt,cutId:z\.id/);
});

test('el contexto activo de caja se prioriza por sesión de usuario', () => {
  assert.match(main, /sessionStorage\.getItem\('sifer360_active_box'\)\|\|localStorage/);
  assert.match(access, /sessionStorage\.setItem\('sifer360_active_box'/);
  assert.match(access, /sessionStorage\.removeItem\('sifer360_active_box'\)/);
});

test('la apertura de caja es obligatoria para finalizar ventas de cajero', () => {
  assert.match(main, /ctx\.role==='cajero'&&ctx\.status!=='abierta'/);
  assert.match(access, /id="sa-open"/);
});
