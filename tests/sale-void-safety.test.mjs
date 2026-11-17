import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sale void refuses collected payments and financing until refund workflow exists', async () => {
  const source = await readFile(new URL('../public/main.js', import.meta.url), 'utf8');
  const start = source.indexOf("if(e.target.id==='saVoid'&&s&&!s.void){");
  assert.notEqual(start, -1, 'sale void handler must exist');
  const handler = source.slice(start, source.indexOf("openWin({title:'Ventas del día", start));
  const guard = handler.indexOf('if(hasCollectedSalePayment)');
  const inventoryRestore = handler.indexOf("s.lines.forEach(l=>");
  assert.ok(guard > -1, 'collected-payment guard must exist');
  assert.ok(guard < inventoryRestore, 'guard must run before stock is restored');
  assert.match(handler, /p\.id\|\|''\)\)!=='credito'/);
  assert.match(handler, /linkedReceivables\.some/);
  assert.match(handler, /!!s\.cashea/);
  assert.match(handler, /reembolso\/reverso correspondiente/);
});
