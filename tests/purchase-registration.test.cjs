'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../public/main.js'),'utf8');

test('RegistrarCompra distingue factura fiscal de documentos no fiscales y exige control fiscal',()=>{
  assert.match(source,/id="cpDocType"/);
  assert.match(source,/NOTA_ENTREGA/);
  assert.match(source,/docType==='FACTURA_FISCAL'&&!ctrlProv/);
  assert.match(source,/taxCreditEligible:docType==='FACTURA_FISCAL'/);
  assert.match(source,/docType==='FACTURA_FISCAL'\?Number\(l\.taxRate/);
});

test('RegistrarCompra consulta y congela la tasa BCV por fecha del documento',()=>{
  assert.match(source,/bcv\.today\/api\/v1\/history\//);
  assert.match(source,/purchaseRateRecord\.date!==docDate/);
  assert.match(source,/rateEffectiveDate:purchaseRateRecord\.effectiveDate/);
  assert.match(source,/bcvRates:S\.bcvRates\|\|\{\}/);
});

test('RegistrarCompra calcula IVA e ISLR retenidos por separado del saldo CxP',()=>{
  assert.match(source,/retUsd=aplicarRetencion\?r2\(iva\*\(retPct\/100\)\):0/);
  assert.match(source,/retIslrUsd=r2\(retIslrBase\*retIslrRate\/100\)/);
  assert.match(source,/id="cpRetIslrBase"/);
  assert.match(source,/dueTs=docDateTs\+creditDays\*86400000/);
  assert.match(source,/total-retUsd-retIslrUsd/);
  assert.match(source,/retencionesIslr/);
});

test('RegistrarCompra propone precio con el motor del producto y permite desactivarlo',()=>{
  assert.match(source,/calcPurchaseSalePrice/);
  assert.match(source,/pricing\.motor==='sale'/);
  assert.match(source,/pricing\.motor==='gap'/);
  assert.match(source,/data-cpf="autoPrice"/);
});

test('RegistrarCompra muestra último costo, CPP actual y CPP proyectado antes de confirmar',()=>{
  assert.match(source,/getLastPurchaseCost/);
  assert.match(source,/Último precio de este proveedor \(sin IVA\) US\$/);
  assert.match(source,/CPP actual US\$/);
  assert.match(source,/Nuevo precio unitario de compra \(sin IVA\) US\$/);
  assert.match(source,/CPP resultante US\$/);
  assert.match(source,/getLastPurchaseCost\(l\.code\)/);
  assert.match(source,/nf8\(projectedCost\)/);
});

test('RegistrarCompra activa por defecto el precio automático según el motor configurado del producto',()=>{
  assert.match(source,/autoPrice:true/);
  assert.match(source,/const motor=pricing\.motor\|\|'cost'/);
  assert.match(source,/if\(motor==='sale'\)/);
  assert.match(source,/else if\(motor==='gap'\)/);
  assert.match(source,/calcPurchaseSalePrice\(p,projectedCost,purchaseRate\)/);
});

test('La tasa BCV visible corresponde a la fecha del documento y queda asociada a la compra',()=>{
  assert.match(source,/Tasa BCV del día del documento/);
  assert.match(source,/rateDate:purchaseRateRecord\.date/);
  assert.match(source,/rateEffectiveDate:purchaseRateRecord\.effectiveDate/);
});

test('CPP proyectado y CPP aplicado al inventario comparten cálculo ponderado robusto ante stock negativo',()=>{
  assert.match(source,/const projectedCost=calcWeightedPurchaseCost\(stock,p\.cost,l\.qty,l\.cost\);/);
  assert.match(source,/const nextCost=calcWeightedPurchaseCost\(p\.stock,p\.cost,l\.qty,l\.cost\);/);
  assert.match(source,/const nextStock=r2\(Number\(p\.stock\|\|0\)\+Number\(l\.qty\)\);/);
});

test('recepción rechaza fichas con stock o CPP corruptos antes de mutar inventario',()=>{
  assert.match(source,/!Number\.isFinite\(Number\(p\.stock\)\)/);
  assert.match(source,/p\.cost===null\|\|p\.cost===undefined\|\|!Number\.isFinite\(Number\(p\.cost\)\)\|\|Number\(p\.cost\)<0/);
  assert.match(source,/Corrija su ficha de inventario antes de recibir la compra/);
});

test('abono inicial de compra usa la tasa actual del pago y conserva la moneda del medio',()=>{
  assert.match(source,/const initialPaymentRate=Number\(S\.cfg\.rate\)>0\?Number\(S\.cfg\.rate\):purchaseRate/);
  assert.match(source,/initialPaymentMethod=METHODS\.find\(m=>m\.name===payMethod\)\|\|\{cur:'VES'\}/);
  assert.match(source,/cur:initialPaymentMethod\.cur,rate:initialPaymentRate,amountBs:r2\(effPaid\*initialPaymentRate\)/);
});
