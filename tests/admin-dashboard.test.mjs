import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  assert.match(css, /\.main\.dashboard-mode\{display:block;overflow:auto/);
  assert.match(css, /@media\(max-width:900px\)\{\.dash-kpis/);
  assert.match(css, /@media\(max-width:560px\)\{\.dash-pie-layout/);
  assert.match(main, /function showDashboardScreen\(\)/);
});

test('the liquor-store build contains no automotive master catalog or OEM form fields', () => {
  assert.doesNotMatch(main, /CATÁLOGO MAESTRO AUTOMOTRIZ|MASTER_CURATED_CATALOG|AUTO_MODELS_MATRIX|VERIFIED_OEM_MAP|masterCatalogBrowserDlg|btnMasterCat|pfOem|Código OEM/);
  assert.match(main, /products:\[\]/);
  assert.match(main, /sales:\[\],held:\[\],purchases:\[\],cxc:\[\],cxp:\[\]/);
  assert.match(main, /Bebidas alcohólicas/);
  assert.match(main, /Botella 750 ml/);
  assert.match(main, /Contenido neto \(ml\)/);
  assert.match(main, /Graduación alcohólica \(% vol\.\)/);
  assert.match(main, /SKU Automático/);
  assert.doesNotMatch(main, /seedSalesSpec|p1Lines|CXC-0001|LIC00001|7501001/);
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


test('fiscal purchase book records real supplier documents, invoice date and line-level VAT rates without fabricated fields', () => {
  assert.match(main, /let pLines=\[\];/);
  assert.match(main, /Nº de factura del proveedor \*/);
  assert.match(main, /id="cpCtrl"/);
  assert.match(main, /id="cpDate" type="date"/);
  assert.match(main, /const docDateTs=docDate\?parseIsoD\(docDate\):0/);
  assert.match(main, /data-cpf="taxRate"/);
  assert.match(main, /Numero_Control_Proveedor/);
  assert.match(main, /Credito_Fiscal_8_Bs/);
  assert.match(main, /Credito_Fiscal_16_Bs/);
  assert.match(main, /Credito_Fiscal_31_Bs/);
  assert.doesNotMatch(main, /p\.ctrlProv\|\|\('00-'\+pad\(p\.no\+4400,8\)\)/);
  assert.doesNotMatch(main, /p\.retIvaDoc\|\|\('202610'\+pad\(idx\+41,8\)\)/);
  assert.doesNotMatch(main, /esc\(r\.estado\|\|'Registro histórico: revisar'\)/);
});

test('fiscal module includes a current inventory book with valuation, Kardex, print and CSV export', () => {
  assert.match(main, /data-tab="inventario">Libro de Inventario/);
  assert.match(main, /const drawInventario=\(\)=>/);
  assert.match(main, /Valor de inventario US\$/);
  assert.match(main, /Libro de movimientos \(Kardex\)/);
  assert.match(main, /id==='btnExpInv'/);
  assert.match(main, /id==='btnPrintInv'/);
  assert.match(main, /Libro_Inventario_SIFER_/);
  assert.match(main, /No inventa movimientos ni existencias de apertura/);
});

test('main POS script parses and no longer references removed purchase IVA toggle state', () => {
  assert.doesNotThrow(() => new vm.Script(main));
  assert.doesNotMatch(main, /applyIva/);
});

test('inventario integra el costo promedio ponderado y valoriza las existencias con CPP', () => {
  const inventory = main.slice(main.indexOf('function inventoryDlg(){'), main.indexOf('/* ---------- MÓDULO DE COMPRAS', main.indexOf('function inventoryDlg(){')));
  assert.match(inventory, /CPP unit\. US\$/);
  assert.match(inventory, /Valor inventario US\$/);
  assert.match(inventory, /Valor inventario a CPP/);
  assert.match(inventory, /Math\.max\(0,p\.stock\)\*Math\.max\(0,p\.cost\)/);
  assert.doesNotMatch(inventory, /data-f="cost"/);
  assert.match(main, /const prevVal=Math\.max\(0,p\.stock\)\*p\.cost/);
  assert.match(main, /const nextCost=nextStock>0\?r8\(\(prevVal\+newVal\)\/nextStock\):l\.cost/);
});

test('compras acepta y conserva hasta ocho decimales en costos, precios, subtotales, IVA, total y CPP', () => {
  assert.match(main, /const r8=n=>Math\.round\(\(n\+Number\.EPSILON\)\*1e8\)\/1e8/);
  assert.match(main, /const nf8=n=>[\s\S]*?toFixed\(8\)/);
  const comprasStart = main.indexOf('function comprasDlg(initialTab)');
  const compras = main.slice(comprasStart, main.indexOf('\nfunction cxcDlg', comprasStart));
  assert.match(compras, /data-cpf="cost" value="\'\+nf8\(l\.cost\)/);
  assert.match(compras, /data-cpf="price" value="\'\+nf8\(l\.price\)/);
  assert.match(compras, /const base=r8\(pLines\.reduce/);
  assert.match(compras, /const iva=r8\(pLines\.reduce/);
  assert.match(compras, /const tot=r8\(base\+iva\)/);
  assert.match(compras, /if\(t\.dataset\.cpf==='cost'\)l\.cost=r8\(val\)/);
  assert.match(compras, /const nextCost=nextStock>0\?r8\(\(prevVal\+newVal\)\/nextStock\):l\.cost/);
  assert.match(main, /nf8\(p\.cost\)/);
});


test('CxP de compras conserva ocho decimales en saldos y pagos y mantiene el historial al anular', () => {
  const purchaseStart = main.indexOf('const renderPurchaseHist=v=>{');
  const purchaseEnd = main.indexOf('const renderSuppliersTab=v=>', purchaseStart);
  const purchaseHistory = main.slice(purchaseStart, purchaseEnd);
  assert.match(purchaseHistory, /const payable=r8\(c\.payableTotal===undefined/);
  assert.match(purchaseHistory, /const paidTotal=r8\(Number\(c\.paid\|\|0\)\+Number\(c\.withheldIslrPaid\|\|0\)\)/);
  assert.match(purchaseHistory, /Pagado \/ Retenido US\$/);
  assert.match(purchaseHistory, /nf8\(c\.total\)/);
  assert.match(purchaseHistory, /nf8\(pend\)/);
  assert.match(purchaseHistory, /x\.void=true;x\.voidedAt=Date\.now\(\)/);
  assert.match(purchaseHistory, /Anulada junto con compra COM-/);
  assert.match(purchaseHistory, /x\.status='ANULADO JUNTO CON COMPRA COM-'/);

  const cxpStart = main.indexOf('function cxpDlg(selId){');
  const cxpEnd = main.indexOf('function newCxpManualDlg(){', cxpStart);
  const cxp = main.slice(cxpStart, cxpEnd);
  assert.match(cxp, /const bal=r8\(Math\.max\(0,Number\(item\.total\|\|0\)-Number\(item\.paid\|\|0\)\)\)/);
  assert.match(cxp, /item\.paid=r8\(Math\.min\(Number\(item\.total\)\|\|0/);
  assert.match(cxp, /nf8\(p\.amountUsd\)/);
  assert.match(cxp, /if\(rawAmt-bal>0\.00000001\)/);
  assert.match(cxp, /mixState\[mid\]\.usd=r8\(b\/rate\)/);
});

test('Corte Z consolida ventas por SKU/código y ajustes de inventario positivos y negativos', () => {
  assert.match(main, /const getProductSales=\(sales\)=>/);
  assert.match(main, /productSales:getProductSales\(sales\)/);
  assert.match(main, /inventoryAdjustments:getInventoryAdjustments\(shiftStart\(\),Date\.now\(\)\)/);
  assert.match(main, /CONSOLIDADO DE PRODUCTOS VENDIDOS · SKU \/ CÓDIGO \/ CANTIDAD/);
  assert.match(main, /AJUSTES DE INVENTARIO · POSITIVOS \(\+\) Y NEGATIVOS/);
  assert.match(main, /Number\(a\.sign\)>0\?/);
});
