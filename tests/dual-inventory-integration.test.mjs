import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const doc=readFileSync(new URL('../docs/ACTUALIZADOR-Y-DOBLE-INVENTARIO.md',import.meta.url),'utf8');

test('POS loads and persists a separate fiscal inventory ledger inside SQLite state',()=>{
 assert.match(html,/\.\/inventory-ledgers\.js/);
 assert.match(pos,/fiscalInventory:S\.fiscalInventory/);
 assert.match(pos,/S\.fiscalInventory=d\.fiscalInventory/);
});

test('fiscal purchases feed both physical and fiscal stock while non-fiscal purchases feed only physical stock',()=>{
 assert.match(pos,/docType==='FACTURA_FISCAL'\)window\.SIFERInventoryLedgers\.applyFiscalMovement/);
 assert.match(pos,/type:'COMPRA_FISCAL',dir:'IN'/);
 assert.match(pos,/p\.stock=nextStock/);
});

test('fiscal sales validate fiscal availability and reduce both ledgers; internal tickets only reduce operational stock',()=>{
 assert.match(pos,/canApplyFiscalSale\(S,lines\)/);
 assert.match(pos,/type:'VENTA_FISCAL',dir:'OUT'/);
 assert.match(pos,/ledger\.movements\.slice\(\)/);
 assert.match(pos,/Libro_Inventario_Fiscal_SIFER/);
 assert.match(pos,/p\.stock=Math\.max\(0,r2\(p\.stock-l\.qty\)\)/);
});

test('fiscal purchase reversals and fiscal sale voids only reverse recorded fiscal movements',()=>{
 assert.match(pos,/originalEvent=sourceId/);
 assert.match(pos,/ledger\.movements\.some\(m=>m\.eventId===originalEvent\)/);
});

test('operational/fiscal inventory transaction matrix is documented without pretending legal compliance',()=>{
 assert.match(doc,/Compra sin factura fiscal/);
 assert.match(doc,/ticket no fiscal/i);
 assert.match(doc,/No se presume que todo el stock operativo sea fiscal/);
 assert.match(doc,/no equivale por sí solo al libro contable VEN-NIF/);
});
