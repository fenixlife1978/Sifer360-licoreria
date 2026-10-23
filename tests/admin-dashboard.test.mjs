import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const dashboard = main.slice(main.indexOf('function showDashboardScreen(){'), main.indexOf('function usersManagementDlg', main.indexOf('function showDashboardScreen(){')));

test('admin login goes straight to the business dashboard and can return from the header', () => {
  assert.match(access, /function renderDashboard\(u\)\{if\(u\.role==='admin'\)[\s\S]{0,350}window\.SIFERDashboard\.show\(\);return;/);
  assert.match(html, /id="adminDashboard"/);
  assert.match(html, /id="btnDashboard"/);
  assert.match(main, /window\.SIFERDashboard=\{show:showDashboardScreen/);
  assert.match(main, /dashboardButton\.addEventListener\('click',\(\)=>showDashboardScreen\(\)\)/);
});

test('dashboard contains requested commercial and financial KPIs', () => {
  assert.match(dashboard, /Ventas del día/);
  assert.match(dashboard, /Ventas del mes/);
  assert.match(dashboard, /Total CxC pendiente/);
  assert.match(dashboard, /Total CxP pendiente/);
  assert.match(dashboard, /Artículos en inventario/);
  assert.match(dashboard, /Unidades en existencia/);
  assert.match(dashboard, /Últimas 5 ventas/);
  assert.match(dashboard, /Últimas 5 compras/);
});

test('dashboard shows latest five transactions and a dimensional payment-method chart, without shortcut buttons', () => {
  assert.match(dashboard, /slice\(0,5\)/);
  assert.match(dashboard, /dash-pie-3d/);
  assert.match(dashboard, /Ventas de hoy por método de pago/);
  assert.doesNotMatch(dashboard, /dash-shortcut|data-dash-action|dash-head-actions/);
  assert.match(css, /\.dash-pie-3d/);
  assert.match(css, /\.dash-table/);
});

test('administrator has user and cashbox management modules in the toolbar', () => {
  assert.match(main, /\['usuarios','Usuarios'/);
  assert.match(main, /\['cajas','Gestión cajas'/);
  assert.match(access, /admin:\[[^\]]*'usuarios','cajas'/);
  assert.match(main, /function usersManagementDlg\(/);
  assert.match(main, /function cashboxesManagementDlg\(/);
  assert.match(access, /getUsers:\(\)=>initUsers\(\),setUsers:users=>\{if\(!Array\.isArray\(users\)\)return false;/);
});

test('cashiers and administrators cannot share a box assignment; admins need an assigned and open box to charge', () => {
  assert.match(main, /La caja '\+cashbox\+' ya está asignada a otro usuario/);
  assert.match(main, /if\(loginUser\.role==='admin'\)[\s\S]{0,500}currentCaja\(\)==='SIN-ASIGNAR'/);
  assert.match(main, /Abra primero el turno de su caja desde Reporte Z antes de cobrar/);
  assert.match(main, /No se puede deshabilitar una caja con turno abierto/);
});

test('every user can end the session from the shared top header', () => {
  assert.match(html, /id="btnLogout"[^>]*>⇥ Cerrar sesión/);
  assert.match(main, /const logoutButton=\$\('#btnLogout'\);if\(logoutButton\)logoutButton\.addEventListener\('click'/);
  assert.match(access, /function logout\(\)/);
});

test('dashboard and management layouts are responsive', () => {
  assert.doesNotMatch(css, /\.main\.dashboard-mode \.left\{display:none!important\}/);
  assert.match(main, /if\(left\)left\.hidden=false; \/\/ Mantener la toolbar completa visible también en el dashboard administrativo/);
  assert.match(css, /@media\(max-width:560px\)\{\.dash-pie-layout/);
});


test('CASHEA initial payment can be split across several real payment methods', () => {
  const assistant = main.slice(main.indexOf('function casheaPaymentAssistantDlg'), main.indexOf('function casheaSimulatorDlg'));
  assert.match(assistant, /Distribución del pago inicial entre varios métodos/);
  assert.match(assistant, /data-csh-initial-method/);
  assert.match(assistant, /initialPayments\.push\(\{id:m\.id,name:m\.name,cur:m\.cur,amount,ref\}\)/);
  assert.match(assistant, /Math\.abs\(r2\(paidInitialUsd-inicialUsd\)\)>0\.01/);
  assert.match(assistant, /initialNeedsRef\.has\(m\.id\)&&!ref/);
  assert.match(main, /draftNow\.refs=\{cashea:cData\.aprobacion\}/);
  assert.match(main, /\(cData\.initialPayments\|\|\[\]\)\.forEach\(p=>\{draftNow\.amts\[p\.id\]=p\.amount;if\(p\.ref\)draftNow\.refs\[p\.id\]=p\.ref;\}\)/);
});

test('admin POS button opens mandatory opening dialog and logout is visible and wired', () => {
  assert.match(main, /\['pos','POS','',openCashboxDlg\]/);
  assert.match(main, /function openCashboxDlg\(/);
  assert.match(main, /function adminCajaRequiredDlg\(/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btnLogout"/);
  assert.match(main, /const logoutButton=\$\('#btnLogout'\);if\(logoutButton\)logoutButton\.addEventListener\('click'/);
  assert.match(access, /function logout\(\)\{sessionStorage\.removeItem\(SESSION\)/);
});


test('finalizar venta muestra un modal centrado con vuelto o VENTA FINALIZADA y permite abrir el ticket', () => {
  assert.match(main, /function showSaleCompletion\(sale\)/);
  const fn = main.slice(main.indexOf('function showSaleCompletion(sale)'), main.indexOf('function finalize(st,amts,isCred,cDays,refs,payEl)'));
  assert.match(fn, /change>=0\.01/);
  assert.match(fn, /VUELTO A ENTREGAR/);
  assert.match(fn, /VENTA FINALIZADA/);
  assert.match(fn, /usd\(change\)/);
  assert.match(fn, /bsf\(r2\(change\*rate\)\)/);
  assert.match(fn, /w:390/);
  assert.match(fn, /Ver \/ imprimir ticket/);
  assert.match(main, /save\(\);renderAll\(\);[\s\S]{0,400}showSaleCompletion\(sale\);/);
  assert.match(css, /\.sale-completion\{display:flex;flex-direction:column;align-items:center;text-align:center/);
});
