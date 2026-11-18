import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');

test('modal close restores app interaction and removes orphaned backdrops',()=>{
  const start=main.indexOf('function closeWin(silent){');
  const end=main.indexOf('\nfunction ask(',start);
  assert.ok(start>=0&&end>start,'closeWin exists');
  const close=main.slice(start,end);
  assert.match(close,/if\(appRoot\)appRoot\.inert=false/);
  assert.match(close,/document\.querySelectorAll\('\.backdrop'\)\.forEach\(el=>el\.remove\(\)\)/);
  assert.match(close,/session&&session\.role!=='cajero'.*cashier-pending/);
});

test('cashier pending lock is explicitly scoped to cashier startup',()=>{
  assert.match(main,/window\.SIFERCashier=\{start:function\(user\)\{document\.body\.classList\.add\('cashier-mode','cashier-pending'\)/);
  assert.match(main,/function applyCashierWorkspace\(\)[\s\S]*?document\.body\.classList\.remove\('cashier-pending'\)/);
  assert.match(access,/function renderDashboard\(u\)[\s\S]*?document\.body\.classList\.remove\('sa-locked'\)/);
});

test('purchase registration retains 8-decimal format while regular views use 2 decimals',()=>{
  assert.ok(main.includes('nf8(l.cost)'), 'purchase unit cost keeps nf8');
  assert.ok(main.includes('nf8(base)'), 'purchase totals preserve 8 decimals');
  assert.ok(main.includes('nf(x.total)'), 'supplier history uses 2-decimal totals');
  assert.ok(main.includes('nf(x.paid)'), 'supplier paid amount uses 2 decimals');
  assert.ok(main.includes('nf(bal)'), 'CxP balances use 2 decimals');
  assert.ok(main.includes('nf(pend)'), 'supplier pending balances use 2 decimals');
  assert.ok(!main.includes('nf8(x.total)'), 'supplier totals do not use 8 decimals');
  assert.ok(!main.includes('nf8(x.paid)'), 'supplier payments do not use 8 decimals');
});

test('fiscal profile captures company email, phone and formal VAT taxpayer status',()=>{
  assert.match(main,/id="fEmail"/);
  assert.match(main,/id="fPhone"/);
  assert.match(main,/id="fFormalIva"/);
  assert.match(main,/companyEmail=\$\('#fEmail',el\)\.value\.trim\(\)/);
  assert.match(main,/companyPhone=\$\('#fPhone',el\)\.value\.trim\(\)/);
  assert.match(main,/contribuyenteFormalIva=\$\('#fFormalIva',el\)\.checked===true/);
  assert.match(main,/Parámetros fiscales incompletos: razón social, RIF, domicilio fiscal y correo son obligatorios/);
});

test('fiscal profile separates IVA and ISLR retention flags and requires notification details',()=>{
  assert.match(main,/id="fRetIslr"/);
  assert.match(main,/retIslrHabilitada=\$\('#fRetIslr',el\)\.checked===true/);
  assert.match(main,/Para activar retenciones debe confirmar Sujeto Pasivo Especial y completar la providencia de notificación/);
});

test('fiscal configuration includes April 2027 digital, machine and contingency emission modes',()=>{
  assert.match(main,/value="DIGITAL_2027"/);
  assert.match(main,/value="MAQUINA_FISCAL"/);
  assert.match(main,/value="CONTINGENCIA_2027"/);
  assert.match(main,/19\/04\/2027/);
});

test('fiscal setup no longer prepopulates fake notification, control, printer or machine identifiers',()=>{
  assert.doesNotMatch(main,/SNAT\/2023\/000412/);
  assert.doesNotMatch(main,/J-31009988-4/);
  assert.doesNotMatch(main,/SENIAT\/DAF\/2022\/981/);
  assert.doesNotMatch(main,/Z4A7719204/);
  assert.match(main,/ctrlNext:1/);
});
