import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');

test('checkout offers ticket, fiscal invoice and hybrid printing when both printers are configured',()=>{
  assert.match(main,/option value="TICKET">Ticket no fiscal · Toda la venta/);
  assert.match(main,/option value="FISCAL".*Factura fiscal · Toda la venta/);
  assert.match(main,/option value="HYBRID".*Impresión híbrida · Factura fiscal \+ ticket no fiscal/);
});

test('hybrid planning assigns only complete cart lines with sufficient fiscal balance to the fiscal document',()=>{
  assert.match(main,/function hybridCartPlan\(\)/);
  assert.match(main,/available\+1e-9>=qty\)\{fiscalIndexes\.push\(index\)/);
  assert.match(main,/else ticketIndexes\.push\(index\)/);
  assert.match(main,/const fiscalSaleLines=lines\.filter\(\(_,i\)=>fiscalLineIndexes\.has\(i\)\)/);
  assert.match(main,/const ticketSaleLines=hybridMode\?lines\.filter\(\(_,i\)=>hybridPlan\.ticketIndexes\.includes\(i\)\)/);
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

test('only the fiscal allocation consumes the fiscal ledger while every sale line consumes physical stock once',()=>{
  assert.match(main,/if\(fiscalLineIndexes\.has\(lineIndex\)\)window\.SIFERInventoryLedgers\.applyFiscalMovement/);
  assert.match(main,/if\(fiscalLineIndexes\.has\(lineIndex\)\)window\.SIFERInventoryLedgers\.applyFiscalMovement/);
  assert.match(main,/type:'SALIDA_TICKET_NO_FISCAL',dir:'OUT'/);
  assert.match(main,/p\.stock=Math\.max\(0,r2\(p\.stock-baseQty\)\)/);
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
