import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('administrator POS toolbar opens a dedicated cash opening dialog',()=>{
  assert.match(main,/function openCashboxDlg\(\)/);
  assert.match(main,/\['pos','POS','',openCashboxDlg\]/);
  assert.match(access,/admin:\[[^\]]*'pos'/);
  assert.match(main,/POS · Apertura de caja/);
  assert.match(main,/Confirmar apertura e ingresar al POS/);
});

test('opening records are assigned to the current admin and saved as active opening',()=>{
  assert.match(main,/username:user\.username,cashbox:box,bs,usd,rate,openedAt,status:'abierta'/);
  assert.match(main,/sessionStorage\.setItem\('sifer360_active_opening',JSON\.stringify\(op\)\)/);
  assert.match(main,/localStorage\.setItem\('sifer360_active_opening',JSON\.stringify\(op\)\)/);
  assert.match(main,/replace\(\/\\s\/g,''\)\.replace\(\/\\\.\/g,''\)/);
});

test('Corte Z refuses to open without a matching active opening and guides admin',()=>{
  assert.match(main,/function corteZDlg\(\)\{\s*const login=activeUser\(\),openingNow=readActiveOpening\(\);[\s\S]{0,500}adminCajaRequiredDlg\('Corte Z'\)/);
  assert.match(main,/function adminCajaRequiredDlg\(moduleName\)/);
  assert.match(main,/El módulo Corte Z ya no abre turnos/);
  assert.match(main,/<section id="zOpenPanel" hidden/);
});

test('global logout control is visible in the common header and wired in the app event code',()=>{
  assert.match(html,/id="btnLogout"/);
  assert.ok((main.match(/const logoutButton=\$\('#btnLogout'\)/g)||[]).length>=1);
  assert.match(main,/SIFERAccess\.logout\(\)/);
});
