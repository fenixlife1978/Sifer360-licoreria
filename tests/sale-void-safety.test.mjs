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
  assert.ok(handler.includes("String(p.id||'')!=='credito'"), 'cash payments must be distinguished from credit entries');
  assert.ok(handler.includes("const saleCashbox=String(s.cashbox||currentCaja())"), 'void must use the originating sale cashbox');
  assert.ok(handler.includes("nextCajaSequence('void',saleCashbox)"), 'void numbering must remain isolated per originating cashbox');
  assert.ok(handler.includes("saleCashbox.replace(/\\W/g,'')"), 'void document number must identify the originating cashbox');
  assert.match(handler, /linkedReceivables\.some/);
  assert.ok(handler.includes("String(x.cashbox||s.cashbox||currentCaja())"), 'legacy receivables must fall back to the originating sale cashbox');
  assert.ok(handler.includes("Number(x.saleNo)===Number(s.no)"), 'receivables must match sale numbers independent of string/number storage');
  assert.ok(handler.includes("S.cxc=(S.cxc||[]).filter"), 'unpaid receivable must be removed with the voided sale');
  assert.match(handler, /!!s\.cashea/);
  assert.match(handler, /reembolso\/reverso correspondiente/);
});
