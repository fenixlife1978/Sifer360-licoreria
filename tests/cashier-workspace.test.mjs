import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('cashier login enters the POS opening flow directly instead of the role dashboard',()=>{
  assert.match(access,/window\.SIFERCashier\.start\(u\)/);
  assert.match(main,/window\.SIFERCashier=\{start:function\(user\)/);\n  assert.match(main,/window\.SIFERAccess&&window\.SIFERAccess\.applyPermissions\)window\.SIFERAccess\.applyPermissions\(user\|\|activeUser\(\)\)/);
  assert.match(main,/POS · Apertura obligatoria de caja/);
  assert.match(main,/onClose:isCashier\?\(\)=>\{\}:undefined/);
  assert.match(main,/Confirmar apertura e ingresar al POS/);
});

test('cashier POS stays gated until a matching opening belongs to the logged-in cashier and box',()=>{
  assert.match(main,/opening\.status!=='abierta'/);
  assert.match(main,/String\(opening\.username\|\|''\)!==String\(session\.username\|\|''\)/);
  assert.match(main,/if\(isCashier&&String\(existing\.username\|\|''\)!==String\(user\.username\|\|''\)\)/);
  assert.match(main,/sessionStorage\.setItem\('sifer360_active_opening',JSON\.stringify\(op\)\)/);
  assert.match(main,/localStorage\.setItem\('sifer360_active_opening',JSON\.stringify\(op\)\)/);
});

test('cashier permissions expose only sales, customer, hold/recover, and own cash close actions',()=>{
  assert.match(access,/cajero:\['nueva','buscar','cliente','suspender','recuperar','descuento','quitar','ventas','cortez'\]/);
  assert.match(access,/btnAccountingTop/);
  assert.match(access,/btnSeniatTop/);
});

test('cashier session does not inherit another role’s stale active cashbox',()=>{
  assert.match(main,/if\(session\.role==='cajero'\)return \{username:session\.username,name:session\.name,role:'cajero',cashbox:session\.cashbox\}/);
  assert.match(main,/String\(c\.cashbox\|\|session\.cashbox\|\|S\.cfg\.caja\|\|'01'\)/);
});

test('toolbars scroll horizontally without shrinking labels or overlapping buttons',()=>{
  assert.match(css,/\.topr\{[^}]*overflow-x:auto/s);
  assert.match(css,/\.toolbar\{[^}]*overflow-x:auto/s);
  assert.match(css,/\.toolbar>\.tb,\.toolbar>\.tsep\{flex:0 0 auto;/);
  assert.match(css,/\.topr>\.menubtn,\.topr>\.linkbtn\{flex:0 0 auto;white-space:nowrap;/);
  assert.match(css,/\.toolbar\.cashier-toolbar\{justify-content:safe center;/);
  assert.match(css,/body\.cashier-pending #toolbar,body\.cashier-pending \.main\{visibility:hidden/);
});

test('cashier opening is session-scoped and never falls back to shared local active opening',()=>{
  const start=main.indexOf('function readActiveOpening()');
  const end=main.indexOf('function zExpectedByMethod',start);
  const block=main.slice(start,end);
  assert.match(block,/if\(user\.role==='cajero'\)/);
  assert.match(block,/String\(sessionValue\.username\|\|''\)!==String\(user\.username\|\|''\)/);
  assert.match(block,/String\(sessionValue\.cashbox\|\|''\)!==String\(user\.cashbox\|\|''\)/);
  assert.match(block,/if\(activeUser\(\)\.role!=='cajero'\)localStorage\.setItem/);
  const cashierBranch=block.slice(block.indexOf("if(user.role==='cajero'){"),block.indexOf("if(sessionValue&&sessionValue.status"));\n  assert.doesNotMatch(cashierBranch,/localStorage/);
});
