import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');

test('universal import accepts CSV, XLSX and JSON without external spreadsheet services',()=>{
  assert.match(main,/accept="\.csv,\.json,\.xlsx"/);
  assert.match(main,/inventoryParseDelimited/);
  assert.match(main,/inventoryParseXlsx/);
  assert.match(main,/inventoryZipEntries/);
  assert.match(main,/new DecompressionStream\('deflate-raw'\)/);
});

test('full backups are filtered to product collections and ignore unrelated entities',()=>{
  assert.match(main,/function inventoryExtractProductRows\(root\)/);
  assert.match(main,/const recognized=new Set\(\['products','product','productos','inventario','inventory','articulos','catalogo','catalog','maestroproductos','inventariomaestro'\]\)/);
  assert.match(main,/function inventoryIsProductRecord\(row\)/);
  assert.match(main,/return candidates\[0\]\|\|\[\]/);
});

test('importer supports dynamic column mapping and preview before committing',()=>{
  assert.match(main,/function inventoryImportFields\(\)/);
  assert.match(main,/function inventoryImportGuess\(headers,field\)/);
  assert.match(main,/Vista previa de/);
  assert.match(main,/Duplicados omitidos/);
  assert.match(main,/confirm\('Se agregarán '/);
});

test('import writes operational products and Kardex opening movements but does not create fiscal stock',()=>{
  assert.match(main,/S\.products\.push\(product\)/);
  assert.match(main,/type:'APERTURA_IMPORTACION',dir:'IN'/);
  assert.match(main,/El inventario fiscal no fue modificado/);
  assert.match(main,/Se restauró el inventario anterior/);
});

test('fiscal opening audit requires document references and caps supported quantities at available physical stock',()=>{
  assert.match(main,/function fiscalOpeningDlg\(\)/);
  assert.match(main,/!\['admin','contador'\]\.includes\(\(activeUser\(\)\|\|\{\}\)\.role\)/);
  assert.match(main,/item\.qty>available\+1e-9\|\|!item\.document/);
  assert.match(main,/type:'APERTURA_FISCAL_INICIAL',dir:'IN'/);
  assert.match(main,/El inventario operativo permaneció intacto/);
});

test('inventory toolbar exposes the universal loader and fiscal opening audit',()=>{
  assert.match(main,/id="btnImportMaster">Cargar inventario maestro/);
  assert.match(main,/id="btnFiscalOpening">Auditoría fiscal inicial/);
  assert.match(main,/if\(e\.target\.id==='btnImportMaster'\)\{inventoryImportDlg\(\)/);
  assert.match(main,/if\(e\.target\.id==='btnFiscalOpening'\)\{fiscalOpeningDlg\(\)/);
});
