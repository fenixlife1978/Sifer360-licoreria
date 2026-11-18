'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');

const source = readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
const start = source.indexOf('function getLastSupplierPurchaseCost(');
const end = source.indexOf('/* ---------- MÓDULO DE COMPRAS Y PROVEEDORES ---------- */', start);
assert.ok(start >= 0 && end > start, 'Debe existir el helper de último costo neto por proveedor');
const helper = source.slice(start, end);

function resolveCost(purchases, code, rif) {
  return runInNewContext(helper + '; getLastSupplierPurchaseCost', {}) (purchases, code, rif);
}

test('último costo de compra se consulta por RIF del proveedor y SKU, no globalmente', () => {
  const purchases = [
    { no: 1, ts: 100, supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 4.25 }] },
    { no: 2, ts: 200, supplier: { rif: 'J-22222222-2' }, lines: [{ code: 'SKU-1', cost: 8.75 }] },
    { no: 3, ts: 300, supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 5.10 }] }
  ];
  assert.equal(resolveCost(purchases, 'SKU-1', 'J-11111111-1'), 5.10);
  assert.equal(resolveCost(purchases, 'SKU-1', 'J-22222222-2'), 8.75);
  assert.equal(resolveCost(purchases, 'SKU-1', 'J-33333333-3'), null);
});

test('el costo del proveedor ignora compras anuladas y normaliza el formato del RIF', () => {
  const purchases = [
    { no: 1, ts: 100, supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 3.50 }] },
    { no: 2, ts: 200, void: true, supplier: { rif: 'J111111111' }, lines: [{ code: 'SKU-1', cost: 99 }] }
  ];
  assert.equal(resolveCost(purchases, 'SKU-1', 'j111111111'), 3.50);
});

test('el historial devuelve el costo unitario sin IVA almacenado en el renglón, incluso si es cero', () => {
  const purchases = [
    { no: 1, docDateTs: 100, ts: 1000, supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 0 }] },
    { no: 2, docDateTs: 200, ts: 900, supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 7 }] }
  ];
  assert.equal(resolveCost(purchases, 'SKU-1', 'J-11111111-1'), 7);
  assert.equal(resolveCost([{ supplier: { rif: 'J-11111111-1' }, lines: [{ code: 'SKU-1', cost: 0 }] }], 'SKU-1', 'J-11111111-1'), 0);
});

test('la captura de compra identifica el último costo neto del proveedor y permite editar el nuevo costo', () => {
  assert.match(source, /Último precio de este proveedor \(sin IVA\) US\$/);
  assert.match(source, /Nuevo precio unitario de compra \(sin IVA\) US\$/);
  assert.match(source, /data-cpf="cost" aria-label="Nuevo precio unitario de compra sin IVA US\$"/);
  assert.match(source, /if\(t\.dataset\.cpf==='cost'\)\{const cost=pnZero\(t\.value\);l\.cost=cost===null\?null:r8\(cost\);l\.costEdited=true;\}/);
  assert.match(source, /cost:last===null\?Number\(p\.cost\|\|0\):last,costEdited:false/);
});

test('el cambio de proveedor actualiza la sugerencia sin pisar costos editados manualmente', () => {
  assert.match(source, /if\(t\.id==='cpSup'\)\{supIdx=\+t\.value;pLines\.forEach\(line=>\{line\.costEdited=false;/);
});

test('compras fiscales alimentan el libro fiscal; compras no fiscales no lo alimentan', () => {
  assert.match(source, /if\(docType==='FACTURA_FISCAL'\)window\.SIFERInventoryLedgers\.applyFiscalMovement\(S,\{eventId:'PURCHASE-/);
  assert.match(source, /p\.stock=nextStock;/);
});

test('ventas fiscales validan saldo fiscal antes de emitir y solo esas ventas descuentan el libro fiscal', () => {
  assert.match(source, /const fiscalCheck=window\.SIFERInventoryLedgers&&window\.SIFERInventoryLedgers\.canApplyFiscalSale\(S,fiscalSaleLines\)/);
  assert.match(source, /if\(fiscalQty>1e-9\)window\.SIFERInventoryLedgers\.applyFiscalMovement\(S,\{eventId:sale\.accountingSourceId\+':'.*?type:'VENTA_FISCAL',dir:'OUT'/);
  assert.match(source, /baseQty=lineBaseQty\(l\),fiscalQty=hybridMode\?Number\(hybridPlan\.fiscalQtyByLine\[lineIndex\]\|\|0\):\(fiscalLineIndexes\.has\(lineIndex\)\?baseQty:0\)/);
  assert.match(source, /p\.stock=Math\.max\(0,r2\(p\.stock-baseQty\)\);/);
});

test('la compra rechaza cantidades y costos no finitos antes de mutar inventario', () => {
  assert.match(source, /Number\.isFinite\(Number\(l\.qty\)\)[\s\S]{0,120}Number\.isFinite\(Number\(l\.cost\)\)/);
  assert.match(source, /try\{lines=pLines\.map\([\s\S]{0,2500}catch\(error\)\{restoreStateSnapshotIfNeeded\(null,rollbackState\)/);
});

test('la venta fiscal exige simultáneamente existencia física y fiscal antes de emitir', () => {
  const validationStart=source.indexOf('const physicalRequired=new Map()', source.indexOf('const pays=METHODS.filter'));
  const fiscalGuard=source.slice(validationStart, source.indexOf('const ticketFiscalOutByLine=', validationStart));
  assert.match(fiscalGuard, /physicalRequired=new Map\(\)/);
  assert.match(fiscalGuard, /Number\(p\.stock\)\+1e-9<qty/);
  assert.match(fiscalGuard, /canApplyFiscalSale\(S,fiscalSaleLines\)/);
  assert.ok(fiscalGuard.indexOf('physicalShort') < fiscalGuard.indexOf('canApplyFiscalSale'));
});

test('anular una compra fiscal revierte el libro fiscal y el stock operativo solo tras validar saldos', () => {
  const start = source.indexOf("const purchaseSourceId='PURCHASE-");
  const end = source.indexOf("const renderSuppliersTab", start);
  const flow = source.slice(start, end);
  assert.match(flow, /canApplyFiscalSale\(S,fiscalLines\)/);
  assert.match(flow, /p\.stock=r2\(p\.stock-l\.qty\)/);
  assert.match(flow, /type:'ANULACION_COMPRA_FISCAL',dir:'OUT'/);
  assert.ok(flow.indexOf('canApplyFiscalSale(S,fiscalLines)') < flow.indexOf("type:'ANULACION_COMPRA_FISCAL'"));
});

test('anular una venta fiscal repone el libro fiscal y el inventario operativo', () => {
  const start = source.indexOf("if(isFiscalSale(s)){", source.indexOf('function salesDlg'));
  const end = source.indexOf("const persisted=await save();", start);
  const flow = source.slice(start, end);
  assert.match(flow, /p\.stock=r2\(p\.stock\+l\.qty\)/);
  assert.match(flow, /type:'ANULACION_VENTA_FISCAL',dir:'IN'/);
});

test('CPP ponderado usa inventario positivo valorado y no distorsiona recepciones con stock negativo',()=>{
  const start=source.indexOf('function calcWeightedPurchaseCost(');
  const end=source.indexOf('function getLastSupplierPurchaseCost(',start);
  assert.ok(start>=0&&end>start,'Debe existir helper CPP de compra');
  const helper=source.slice(start,end);
  const calc=runInNewContext(helper+'; calcWeightedPurchaseCost',{r8:n=>Math.round((Number(n)+Number.EPSILON)*1e8)/1e8});
  assert.equal(calc(10,4,5,7),5);
  assert.equal(calc(-3,10,5,6),6);
  assert.equal(calc(2,5,2,0),2.5);
});

test('el precio unitario vacío no se interpreta como costo cero y el costo cero real sí se acepta',()=>{
  assert.match(source,/data-cpf="cost" aria-label="Nuevo precio unitario de compra sin IVA US\$"[^>]*required/);
  assert.match(source,/const cost=pnZero\(t\.value\);l\.cost=cost===null\?null:r8\(cost\);l\.costEdited=true;/);
  assert.match(source,/l\.cost===null\|\|l\.cost===undefined/);
});

test('un precio borrado permanece visualmente vacío hasta corregirlo',()=>{
  assert.ok(source.includes("value=\"'+(l.cost===null?'':nf8(l.cost))+'\" inputmode=\"decimal\">"));
});

test('compras del mismo día en cajas distintas desempatan por hora de registro real',()=>{
  const purchases=[
    {no:1,cashbox:'CAJA-01',docDateTs:5000,ts:100,supplier:{rif:'J-11111111-1'},lines:[{code:'SKU-1',cost:4}]},
    {no:1,cashbox:'CAJA-02',docDateTs:5000,ts:300,supplier:{rif:'J-11111111-1'},lines:[{code:'SKU-1',cost:9}]}
  ];
  assert.equal(resolveCost(purchases,'SKU-1','J-11111111-1'),9);
});

test('el historial de compras del administrador incluye compras ADMIN y anula por número más caja de origen',()=>{
  assert.ok(source.includes("const list=(S.purchases||[]).slice().sort((a,b)=>Number(b.no)-Number(a.no)||Number(b.ts||0)-Number(a.ts||0));"));
  assert.ok(source.includes("data-void-box=\"'+esc(c.cashbox||'01')+'\""));
  assert.ok(source.includes("Number(x.no)===Number(b.dataset.voidComp)&&String(x.cashbox||'01')===String(b.dataset.voidBox||'01')"));
  assert.ok(source.includes("adminMode=activeUser().role==='admin', all=(S.cxp||[]).filter(x=>!x.void&&(adminMode||String(x.cashbox||currentCaja())===currentCaja()));"));
});
