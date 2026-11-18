import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');

function runHybrid(cart,balances){
  const start=main.indexOf('function hybridCartPlan(){');
  const end=main.indexOf('\nfunction salePortion',start);
  assert.ok(start>=0&&end>start,'hybridCartPlan helper exists');
  const context={
    S:{cart,fiscalInventory:{balances}},
    window:{SIFERInventoryLedgers:{ensureFiscalInventory:state=>state.fiscalInventory}},
    lineBaseQty:line=>Number(line.qty||0)*Math.max(1e-8,Number(line.factor)||1),
    r8:value=>Math.round((Number(value)+Number.EPSILON)*1e8)/1e8,
    r2:value=>Math.round((Number(value)+Number.EPSILON)*100)/100,
    Number,Math
  };
  vm.runInNewContext(main.slice(start,end)+';globalThis.run=hybridCartPlan;',context);
  return context.run();
}

function runTicketFiscalOut(lines,ticketLines,fiscalLines,balances,physical){
  const start=main.indexOf('function ticketFiscalOutPlan(');
  const end=main.indexOf('\nfunction totals',start);
  assert.ok(start>=0&&end>start,'ticketFiscalOutPlan helper exists');
  const context={
    S:{fiscalInventory:{balances}},
    window:{SIFERInventoryLedgers:{ensureFiscalInventory:state=>state.fiscalInventory}},
    prod:code=>({stock:physical[code]||0}),
    r8:value=>Math.round((Number(value)+Number.EPSILON)*1e8)/1e8,
    Number,Math,Map,Set
  };
  vm.runInNewContext(main.slice(start,end)+';globalThis.run=ticketFiscalOutPlan;',context);
  return context.run(lines,ticketLines,fiscalLines);
}

test('checkout offers ticket, fiscal invoice and hybrid printing when both printers are configured',()=>{
  assert.match(main,/option value="TICKET">Ticket no fiscal · Toda la venta/);
  assert.match(main,/option value="FISCAL".*Factura fiscal · Toda la venta/);
  assert.match(main,/option value="HYBRID".*Impresión híbrida · Factura fiscal \+ ticket no fiscal/);
});

test('hybrid splits a single cart line between supported fiscal quantity and remaining thermal-ticket quantity',()=>{
  const plan=runHybrid([{code:'BOTTLE',qty:5,factor:1,net:500,iva:80}],{BOTTLE:{stock:3}});
  assert.deepEqual(Array.from(plan.fiscalIndexes),[0]);
  assert.deepEqual(Array.from(plan.ticketIndexes),[0]);
  assert.equal(plan.fiscalLines[0].qty,3);
  assert.equal(plan.fiscalLines[0].presentationQty,3);
  assert.equal(plan.ticketLines[0].qty,2);
  assert.equal(plan.ticketLines[0].presentationQty,2);
  assert.equal(plan.fiscalLines[0].net+plan.ticketLines[0].net,500);
  assert.equal(plan.fiscalLines[0].iva+plan.ticketLines[0].iva,80);
});

test('hybrid never fractures a pack presentation and allocates whole packs only',()=>{
  const plan=runHybrid([{code:'PACK6',qty:2,factor:6,net:120,iva:19.2}],{PACK6:{stock:9}});
  assert.equal(plan.fiscalLines[0].qty,6);
  assert.equal(plan.fiscalLines[0].presentationQty,1);
  assert.equal(plan.ticketLines[0].qty,6);
  assert.equal(plan.ticketLines[0].presentationQty,1);
});

test('hybrid allocates fiscal stock across repeated SKU lines in cart order',()=>{
  const plan=runHybrid([
    {code:'SAME',qty:2,factor:1,net:200,iva:32},
    {code:'SAME',qty:3,factor:1,net:300,iva:48}
  ],{SAME:{stock:3}});
  assert.deepEqual(Array.from(plan.fiscalLines,l=>[l.lineIndex,l.qty]),[[0,2],[1,1]]);
  assert.deepEqual(Array.from(plan.ticketLines,l=>[l.lineIndex,l.qty]),[[1,2]]);
});

test('thermal ticket consumes non-fiscal stock first and only then fiscal-backed stock',()=>{
  const out=runTicketFiscalOut([{code:'A',qty:6}], [{code:'A',qty:6,lineIndex:0}], [{code:'A',qty:3}], {A:{stock:6}}, {A:10});
  assert.equal(out.get(0),2);
});

test('fiscal printer payload contains only the fiscal portion and uses the selected presentation details',()=>{
  assert.match(main,/lines:fiscalDocumentSale\.lines\.map\(line=>/);
  assert.match(main,/unit:line\.presentationUnit\|\|line\.unit,quantity:line\.presentationQty\|\|line\.qty/);
  assert.match(main,/unitPriceUsd:line\.presentationPrice\|\|line\.price/);
});

test('hybrid documents share one sale identity and allocate tax, payments and change without duplicating amounts',()=>{
  assert.match(main,/function salePortion\(sale,lines,mode,residual,fiscalRatio\)/);
  assert.match(main,/residual\?r2\(Number\(pay\.amount\|\|0\)-r2\(Number\(pay\.amount\|\|0\)\*ratio\)\)/);
  assert.match(main,/residual\?r2\(Number\(sale\.igtf\|\|0\)-r2\(Number\(sale\.igtf\|\|0\)\*ratio\)\)/);
  assert.match(main,/ticketDocumentSale\.ticketReference='TKT-'/);
  assert.match(main,/sale\.ticketDocument=ticketDocumentSale/);
});

test('mixed hybrid Cashea is blocked until its financing can be allocated safely',()=>{
  assert.match(main,/hybridHasFiscal&&hybridHasTicket&&\(Number\(amts\.cashea\)\|\|0\)>0/);
  assert.match(main,/La impresión híbrida con Cashea requiere una distribución/);
});

test('fiscal portion and ticket-backed consumption use separate per-line quantities while physical stock is deducted once',()=>{
  assert.match(main,/fiscalQty=hybridMode\?Number\(hybridPlan.fiscalQtyByLine\[lineIndex\]\|\|0\)/);
  assert.match(main,/type:'SALIDA_TICKET_NO_FISCAL',dir:'OUT'/);
  assert.match(main,/p\.stock=Math\.max\(0,r2\(p\.stock-baseQty\)\)/);
});

test('hybrid sale payload aggregates ticket fiscal exits by SKU from per-line allocations',()=>{
  assert.doesNotMatch(main,/ticketFiscalOutByCode/);
  assert.match(main,/ticketFiscalOut:Array\.from\(ticketFiscalOutLines\.reduce\(\(byCode,line\)=>byCode\.set\(line\.code,\(byCode\.get\(line\.code\)\|\|0\)\+Number\(line\.qty\|\|0\)\),new Map\(\)\)\.entries\(\)\)/);
  const lines=[{code:'A',qty:1.25},{code:'A',qty:0.75},{code:'B',qty:2}];
  const totals=Array.from(lines.reduce((byCode,line)=>byCode.set(line.code,(byCode.get(line.code)||0)+Number(line.qty||0)),new Map()).entries());
  assert.deepEqual(totals,[['A',2],['B',2]]);
});

test('hybrid completion offers a separate thermal ticket without repeating the fiscal invoice or sale',()=>{
  assert.match(main,/if\(hybrid&&ticketDocument&&ticketDocument\.lines\.length\)foot\.push/);
  assert.match(main,/showTicket\(ticketDocument\)/);
  assert.match(main,/sale\.ticketDocument\.printStatus='uncertain';sale\.ticketDocument\.printStartedAt=Date\.now\(\)/);
  assert.match(main,/const intentSaved=await save\(\);[\s\S]*?printerPrintTicket\(thermal\.printerName,ticketText\(sale\.ticketDocument,columns\)/);
  assert.match(main,/s\.documentMode==='HYBRID'/);
});

test('hybrid fiscal portions feed only fiscal books while tickets remain in commercial, IGTF and bank reports',()=>{
  assert.match(main,/function fiscalSaleData\(sale\)/);
  assert.match(main,/return Object\.assign\(\{\},sale,part,\{fiscal:sale\.fiscal,documentMode:'FISCAL',docType:'01-FACTURA'/);
  assert.match(main,/const getFilteredAllSales=\(\)=>/);
  assert.match(main,/const getFilteredSales=\(\)=>getFilteredAllSales\(\)\.filter\(isFiscalSale\)\.map\(fiscalSaleData\)/);
  assert.match(main,/const drawIgtf=\(\)=>\{\s*const sales=getFilteredAllSales\(\)/);
  assert.match(main,/const drawSudeban=\(\)=>\{\s*const sales=getFilteredAllSales\(\)/);
  assert.match(main,/\.filter\(x=>isFiscalSale\(x\)&&!x\.void&&enPeriodoSeniat\(x\.ts\)\)\.map\(fiscalSaleData\)/);
});

test('reprinting an already sent or uncertain hybrid ticket requires explicit duplicate confirmation',()=>{
  assert.match(main,/s\.documentMode==='HYBRID'&&s\.printStatus==='sent'&&!confirm\(/);
  assert.match(main,/s\.documentMode==='HYBRID'&&s\.printStatus==='uncertain'&&!confirm\(/);
});

function runSalePortion(sale,lines,mode,residual,fiscalRatio){
  const start=main.indexOf('function salePortion(');
  const end=main.indexOf('\nfunction ticketFiscalOutPlan',start);
  assert.ok(start>=0&&end>start,'salePortion helper exists');
  const context={r2:value=>Math.round((Number(value)+Number.EPSILON)*100)/100,Number,Math};
  vm.runInNewContext(main.slice(start,end)+';globalThis.run=salePortion;',context);
  return context.run(sale,lines,mode,residual,fiscalRatio);
}

test('hybrid pack subtotal uses presentation quantity instead of base-unit quantity',()=>{
  const sale={total:232,pays:[{method:'cash',amount:100.01},{method:'zelle',amount:131.99}],igtf:6.96,change:0.01};
  const fiscalLine={code:'PACK6',price:120,presentationPrice:120,qty:6,presentationQty:1,net:100,iva:16,taxRate:16};
  const portion=runSalePortion(sale,[fiscalLine],'FISCAL',false,0.5);
  const residual=runSalePortion(sale,[fiscalLine],'HYBRID',true,0.5);
  assert.equal(portion.sub,120);
  assert.equal(portion.disc,20);
  assert.equal(portion.base,100);
  assert.equal(portion.iva,16);
  assert.equal(portion.total,116);
  assert.equal(residual.sub,120);
  assert.equal(residual.disc,20);
  assert.equal(residual.total,116);
  assert.deepEqual(Array.from(portion.pays,p=>p.amount),[50.01,66]);
  assert.deepEqual(Array.from(residual.pays,p=>p.amount),[50,65.99]);
  assert.equal(portion.pays[0].amount+residual.pays[0].amount,sale.pays[0].amount);
  assert.equal(portion.pays[1].amount+residual.pays[1].amount,sale.pays[1].amount);
  assert.equal(portion.igtf+residual.igtf,sale.igtf);
  assert.equal(portion.change+residual.change,sale.change);
});
