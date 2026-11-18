import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

test('POS presents a choice when a product has multiple configured presentations', () => {
  assert.match(pos, /function productPresentations\(p\)/);
  assert.match(pos, /function presentationPickDlg\(p,qty,selectedIndex\)/);
  assert.match(pos, /presentations\.length>1\)\{presentationPickDlg\(p,qty,0\)/);
  assert.match(pos, /presentationIndex:idx/);
});

test('POS scans a presentation barcode and adds that exact presentation', () => {
  assert.match(pos, /productPresentations\(candidate\)\.findIndex\(pr=>String\(pr\.barcode\|\|''\)/);
  assert.match(pos, /addItem\(p\.code,pe\.qty,matchedPresentationIndex\)/);
});

test('cart uses the presentation price and quantity while reserving base inventory units', () => {
  assert.match(pos, /function lineBaseQty\(l\)\{return r8\(Number\(l&&l\.qty\|\|0\)\*Math\.max\(1e-8,Number\(l&&l\.factor\)\|\|1\)\);\}/);
  assert.match(pos, /const reserved=S\.cart\.filter\(l=>l\.code===code\)\.reduce\(\(a,l\)=>a\+lineBaseQty\(l\),0\)/);
  assert.match(pos, /const price=Number\(pr\.price\)>0\?Number\(pr\.price\):r2\(Number\(p\.price\|\|0\)\*factor\)/);
  assert.match(pos, /qty:lineBaseQty\(l\),[\s\S]*?presentationQty:l\.qty,[\s\S]*?presentationFactor:i\.factor/);
});

test('quantity changes and stock deduction account for every presentation factor', () => {
  assert.match(pos, /lineBaseQty\(\{\.\.\.l,qty:nq\}\)>available\+1e-9/);
  assert.match(pos, /const baseQty=lineBaseQty\(l\);[\s\S]*?p\.stock=Math\.max\(0,r2\(p\.stock-baseQty\)\)/);
  assert.match(pos, /qty:baseQty,stockAfter:p\.stock/);
});

test('ticket preview prints the selected presentation name, quantity and presentation price', () => {
  assert.match(pos, /const displayQty=Number\(l\.presentationQty\)>0\?Number\(l\.presentationQty\):Number\(l\.qty\|\|0\)/);
  assert.match(pos, /const displayPrice=Number\(l\.presentationPrice\)>0\?Number\(l\.presentationPrice\):Number\(l\.price\|\|0\)/);
});

test('return prompts identify the sold presentation while keeping returned quantities in base units',()=>{
  assert.match(pos,/line\.presentationQty\)>0\?Number\(line\.presentationQty\):Number\(line\.qty\|\|0\)/);
  assert.match(pos,/Vendido '\+fq\(presentationQty\)\+' '\+unit\+' \('/);
  assert.match(pos,/Renglones y cantidades a devolver en UNIDADES BASE/);
});
