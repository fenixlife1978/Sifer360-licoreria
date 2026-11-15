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
  assert.match(source,/total-retUsd-retIslrUsd/);
  assert.match(source,/retencionesIslr/);
});

test('RegistrarCompra propone precio con el motor del producto y permite desactivarlo',()=>{
  assert.match(source,/calcPurchaseSalePrice/);
  assert.match(source,/pricing\.motor==='sale'/);
  assert.match(source,/pricing\.motor==='gap'/);
  assert.match(source,/data-cpf="autoPrice"/);
});
