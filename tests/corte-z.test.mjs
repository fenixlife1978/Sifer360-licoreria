import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');

test('Corte Z carga la apertura antes de calcular el inicio del turno', () => {
  const fn = pos.slice(pos.indexOf('function corteZDlg(){'), pos.indexOf('const TB='));
  assert.match(fn, /let active=readActiveOpening\(\);/);
  assert.match(fn, /const shiftStart=\(\)=>active&&active\.openedAt/);
  assert.doesNotMatch(fn, /const shiftStart=active&&active\.openedAt[\s\S]{0,150}const active=/);
});

test('Corte Z permite registrar fondo inicial cuando no hay turno abierto', () => {
  assert.match(pos, /id="zOpeningBs"/);
  assert.match(pos, /id="zOpeningUsd"/);
  assert.match(pos, /id="zOpenShift"/);
  assert.match(pos, /status:'abierta'/);
  assert.match(pos, /writeActiveOpening\(active\)/);
});

test('el arqueo compara cada método de pago y calcula diferencia real menos sistema', () => {
  assert.match(pos, /data-z-real=/);
  assert.match(pos, /Saldo en sistema/);
  assert.match(pos, /Monto real contado \/ conciliado/);
  assert.match(pos, /r2\(real\[r\.id\]-r\.system\)/);
  assert.match(pos, /shortageUsd/);
  assert.match(pos, /surplusBs/);
  assert.match(pos, /CONCILIADO · CUADRA/);
});

test('no permite cerrar hasta que todos los métodos tengan importe real explícito', () => {
  assert.match(pos, /Complete el importe real de todos los métodos de pago/);
  assert.match(pos, /!result\.total\.complete/);
});

test('el Corte Z guarda conciliación, observaciones, apertura y operador en el historial', () => {
  assert.match(pos, /reconciliation:rec/);
  assert.match(pos, /reconciliationStatus:status/);
  assert.match(pos, /observations:\$\('\#zObservations',el\)\.value\.trim\(\)/);
  assert.match(pos, /openingId:active\.id/);
  assert.match(pos, /getZHistory\(\)\.push\(z\)/);
});

test('historial tiene acciones separadas para mostrar y reimprimir cada Corte Z', () => {
  assert.match(pos, /data-z-view=/);
  assert.match(pos, /data-z-print=/);
  assert.match(pos, /if\(view\)[\s\S]{0,220}printCorteZ\(z,false\)/);
  assert.match(pos, /if\(reprint\)[\s\S]{0,220}printCorteZ\(z,true\)/);
});

test('reporte térmico incluye detalle de conciliación y aclara que no emite fiscal', () => {
  assert.match(pos, /@page\{size:80mm auto/);
  assert.match(pos, /ARQUEO DE CAJA · POR MÉTODO/);
  assert.match(pos, /TOTALES COBRADOS · POR MÉTODO/);
  assert.match(pos, /Diferencia/);
  assert.match(pos, /ni registra una operación directamente en una impresora fiscal/);
});

test('Corte Z abre vista previa térmica de 80 mm antes de imprimir al confirmar el cierre', () => {
  assert.match(pos, /Vista previa de impresión · Térmica 80 mm/);
  assert.match(pos, /onclick="window\.print\(\)"/);
  assert.match(pos, /\.zpreview-tools\{display:none!important\}/);
  assert.match(pos, /msg\('Corte Z '\+z\.id\+' guardado\. Resultado: '\+status\+'\. Se abrirá la vista previa de 80 mm para imprimir\.'\);\s*printCorteZ\(z,false\);draw\(\);/);
});

test('el reporte Z destaca el arqueo por método antes de detallar movimientos físicos', () => {
  const printStart = pos.indexOf('function printCorteZ(');
  const printEnd = pos.indexOf('function corteZDlg(', printStart);
  const report = pos.slice(printStart, printEnd);
  assert.match(report, /ARQUEO DE CAJA · POR MÉTODO/);
  assert.match(report, /RESULTADO DEL ARQUEO/);
  assert.match(report, /SISTEMA/);
  assert.match(report, /REAL CONTADO O CONCILIADO/);
  assert.match(report, /DIFERENCIA/);
  assert.ok(report.indexOf('ARQUEO DE CAJA · POR MÉTODO') < report.indexOf('MOVIMIENTOS DE EFECTIVO FÍSICO'));
  assert.match(report, /Este Corte Z no contiene detalle de arqueo por método/);
});

function extractFunction(name, nextName) {
  const start = pos.indexOf('function ' + name + '(');
  const end = pos.indexOf('function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, 'Debe existir ' + name + ' y su siguiente función');
  return pos.slice(start, end);
}

test('cálculo real de saldos por método incluye fondo inicial y resta el vuelto', () => {
  const methodSource = extractFunction('zExpectedByMethod', 'zDiffStatus');
  const calculate = runInNewContext(
    'const r2=n=>Math.round((n+Number.EPSILON)*100)/100;' +
    'const METHODS=[{id:"efUSD"},{id:"zelle"},{id:"cashea"},{id:"efBs"},{id:"punto"},{id:"biopago"},{id:"pmovil"},{id:"transf"}];' +
    'const S={cfg:{rate:10}};' + methodSource + ';zExpectedByMethod'
  );
  const result = calculate([
    { rate: 10, change: 1, pays: [{ id: 'efBs', amount: 110 }] },
    { rate: 10, change: 0, pays: [{ id: 'zelle', amount: 25 }, { id: 'punto', amount: 50 }] }
  ], { bs: 100, usd: 5 });
  assert.equal(result.efBs, 200);
  assert.equal(result.efUSD, 5);
  assert.equal(result.zelle, 25);
  assert.equal(result.punto, 50);
  assert.equal(result.cashea, 0);
});

test('estado de conciliación distingue cuadra, faltante, sobrante y mezcla', () => {
  const statusSource = extractFunction('zDiffStatus', 'printCorteZ');
  const status = runInNewContext(statusSource + ';zDiffStatus');
  assert.equal(status([{ diff: 0 }, { diff: 0.009 }]), 'CONCILIADO · CUADRA');
  assert.equal(status([{ diff: -3 }, { diff: 0 }]), 'FALTANTE');
  assert.equal(status([{ diff: 4 }, { diff: 0 }]), 'SOBRANTE');
  assert.equal(status([{ diff: -3 }, { diff: 4 }]), 'CON DIFERENCIAS · FALTANTES Y SOBRANTES');
});

test('la vista previa 80 mm está disponible antes de confirmar el cierre y no guarda el corte', () => {
  const fn = pos.slice(pos.indexOf('function corteZDlg(){'), pos.indexOf('const TB='));
  assert.match(fn, /id="zPreview">Vista previa del reporte Z · 80 mm/);
  assert.match(fn, /id="zClose">Confirmar cierre e imprimir/);
  assert.ok(fn.indexOf('id="zPreview"') < fn.indexOf('id="zClose"'));
  assert.match(fn, /if\(e\.target\.id==='zPreview'\)[\s\S]*?const draft=\{/);
  assert.match(fn, /payments:zPayTotals\(sales\)/);
  assert.match(fn, /reconciliation:rec/);
  assert.match(fn, /printCorteZ\(draft,false\);return;/);
  assert.match(pos, /Object\.entries\(z\.payments\)\.map\(\(\[name,amount\]\)=>line\(name,name\.includes\('\(VES\)'\)\?bsf\(amount\):usd\(amount\)\)/);
});

test('el cierre explica visiblemente los requisitos y se habilita solo con arqueo completo', () => {
  assert.match(pos, /id="zActionStatus" role="status" aria-live="polite"/);
  assert.match(pos, /Arqueo incompleto: ingrese el monto real de los 8 métodos de pago/);
  assert.match(pos, /Arqueo completo\. Puede revisar la vista previa de 80 mm y confirmar el cierre/);
  assert.match(pos, /\$\('#zClose',el\)\.disabled=!opened\|\|!result\.total\.complete/);
});

test('el formulario de arqueo está destacado antes de movimientos de caja', () => {
  const fn = pos.slice(pos.indexOf('function corteZDlg(){'), pos.indexOf('const TB='));
  assert.match(fn, /id="zArqueoPanel"[\s\S]*?ARQUEO PREVIO POR MÉTODO DE PAGO/);
  assert.ok(fn.indexOf('id="zArqueoPanel"') < fn.indexOf('Movimientos de efectivo físico'));
  assert.match(fn, /id="zReconcile"/);
  assert.match(fn, /id="zTotals"/);
  assert.match(fn, /si no tuvo movimientos, escriba 0,00/i);
  assert.doesNotMatch(fn, /\$\('#zClose',el\)\.disabled=!opened;\s*\$\('#zPreview',el\)\.disabled=!opened;/);
});


test('Corte Z reutiliza la apertura de inicio de sesión y oculta la segunda apertura si ya existe turno', () => {
  const fn = pos.slice(pos.indexOf('function corteZDlg(){'), pos.indexOf('const TB='));
  assert.match(fn, /\$\('#zOpenPanel',el\)\.hidden=opened/);
  assert.match(fn, /La apertura de caja ya está registrada\. Se reutiliza el turno iniciado al entrar al POS/);
  assert.match(fn, /No se detectó una apertura válida para esta caja\. Registre el fondo inicial aquí solo si no se hizo al iniciar sesión/);
  assert.match(access, /sessionStorage\.setItem\('sifer360_active_opening',JSON\.stringify\(op\)\)/);
  assert.match(pos, /const boxOpen=\(\)=>!!\(active&&String\(active\.cashbox\)===box&&active\.status==='abierta'\)/);
});
