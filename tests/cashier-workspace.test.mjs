import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('cashier login opens POS and applies restricted permissions before cash opening',()=>{
  assert.match(access,/window\.SIFERCashier\.start\(u\)/);
  assert.match(main,/window\.SIFERCashier=\{start:function\(user\)/);
  assert.match(main,/window\.SIFERAccess&&window\.SIFERAccess\.applyPermissions\)window\.SIFERAccess\.applyPermissions\(user\|\|activeUser\(\)\)/);
  assert.match(main,/POS · Apertura obligatoria de caja/);
  assert.match(main,/onClose:isCashier\?\(\)=>\{\}:undefined/);
  assert.match(main,/Confirmar apertura e ingresar al POS/);
});

test('cashier POS is blocked until an opening matches the logged-in cashier and assigned box',()=>{
  assert.match(main,/opening\.status!=='abierta'/);
  assert.match(main,/String\(opening\.username\|\|''\)!==String\(session\.username\|\|''\)/);
  assert.match(main,/if\(isCashier&&String\(existing\.username\|\|''\)!==String\(user\.username\|\|''\)\)/);
});

test('cashier opening state is isolated to the authenticated browser session',()=>{
  const start=main.indexOf('function readActiveOpening(boxOverride)');
  const end=main.indexOf('function upsertOpeningState',start);
  const block=main.slice(start,end);
  assert.match(block,/const user=activeUser\(\)/);
  assert.match(block,/user\.role!=='cajero'\|\|\(String\(item\.username\|\|''\)===String\(user\.username\|\|''\)&&String\(item\.cashbox\|\|''\)===String\(user\.cashbox\|\|''\)\)/);
  assert.match(block,/matches\.sort/);
  assert.doesNotMatch(block,/localStorage/);
});

test('cashier toolbar shows only sales workflow actions',()=>{
  assert.match(access,/cajero:\['nueva','buscar','cliente','suspender','recuperar','descuento','quitar','ventas','cortez','tasa','salidas'\]/);
  assert.match(access,/btnAccountingTop/);
  assert.match(access,/btnSeniatTop/);
});

test('toolbars scroll horizontally without overlapping button labels',()=>{
  assert.match(css,/\.topr\{[^}]*overflow-x:auto/s);
  assert.match(css,/\.toolbar\{[^}]*overflow-x:auto/s);
  assert.match(css,/\.toolbar>\.tb,\.toolbar>\.tsep\{flex:0 0 auto;/);
  assert.match(css,/\.topr>\.menubtn,\.topr>\.linkbtn\{flex:0 0 auto;white-space:nowrap;/);
  assert.match(css,/\.toolbar\.cashier-toolbar\{justify-content:center;justify-content:safe center;/);
  assert.match(css,/body\.cashier-pending #toolbar,body\.cashier-pending \.main\{visibility:hidden/);
});

test('cashier CxC view hides portfolio KPIs and manual charge creation, with guarded manual entry',()=>{
  assert.match(main,/const cashierMode=activeUser\(\)\.role==='cajero'/);
  assert.match(main,/id="cxcKpis"\W*\+\(cashierMode\?' style="display:none"'/);
  assert.match(main,/cashierMode\?'':'<button class="btn mini2" id="cxcNewBtn"/);
  assert.match(main,/if\(activeUser\(\)\.role==='cajero'\)\{msg\('El rol cajero no tiene permiso para crear cargos manuales de CxC\.'/);
  assert.match(main,/function newCxcManualDlg\(\)\{\s*if\(activeUser\(\)\.role==='cajero'\)/);
});
test('cashier can update BCV rate with a mandatory audited reason and opening identity',()=>{
  assert.match(access,/cajero:\[[^\]]*'tasa'[^\]]*\]/);
  assert.match(main,/function tasaBcvDlg\(\)/);
  assert.match(main,/if\(!reason\)/);
  assert.match(main,/previousRate:oldRate,newRate:next,reason,username:user\.username/);
  assert.match(main,/cashbox:opening\.cashbox,openingId:opening\.id/);
  assert.match(main,/activeUser\(\)\.role==='cajero'\?tasaBcvDlg\(\):cfgDlg\('cRate'\)/);
});

test('cashier can register justified collaboration, own consumption and donation stock exits in Kardex',()=>{
  assert.match(access,/cajero:\[[^\]]*'salidas'[^\]]*\]/);
  assert.match(main,/\['salidas','Salidas inventario','',inventoryExitDlg\]/);
  assert.match(main,/function inventoryExitDlg\(\)/);
  assert.match(main,/COLABORACION/);
  assert.match(main,/CONSUMO_PROPIO/);
  assert.match(main,/DONACION/);
  assert.match(main,/if\(qty>Number\(p\.stock\)\)/);
  assert.match(main,/if\(!reason\)/);
  assert.match(main,/p\.stock=r2\(before-qty\)/);
  assert.match(main,/addKardex\(\{ts,code:p\.code,type:concept,dir:'OUT'/);
  assert.match(main,/cashbox:currentCaja\(\),qty,stockAfter:p\.stock,cost,user:user\.name/);
});

test('reload preserves authenticated session and restores the last permitted module',()=>{
  assert.match(access,/const saved=\(\(\)=>\{try\{return JSON\.parse\(sessionStorage\.getItem\(SESSION\)\|\|'null'\)/);
  assert.doesNotMatch(access,/sessionStorage\.removeItem\(SESSION\);shell\(\);/);
  assert.match(main,/sifer360_last_module_v1:/);
  assert.match(main,/localStorage\.setItem\('sifer360_last_module_v1:'\+user\.username,b\.dataset\.tb\)/);
  assert.match(main,/function restoreWorkspaceAfterReload\(\)/);
  assert.match(main,/button&&!button\.hidden\)\{button\.click\(\);return;\}/);
  assert.match(main,/window\.SIFERCashier\.start\(user\)/);
});
