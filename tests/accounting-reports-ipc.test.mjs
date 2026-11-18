import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
const preload=readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');

test('el mayor general exige sesión, cuenta y fechas y consulta solo asientos contabilizados o reversados',()=>{
  assert.match(main,/registerAccountingHandler\('accounting:get-general-ledger'/);
  assert.match(main,/accountingActor\(input\)/);
  assert.match(main,/j\.status IN \('posted','reversed'\)/);
  assert.match(main,/j\.entry_date<=\?/);
  assert.match(main,/buildGeneralLedger/);
  assert.match(preload,/accountingGetGeneralLedger/);
});

test('los estados financieros parten de un período existente y consolidan el plan contable',()=>{
  assert.match(main,/registerAccountingHandler\('accounting:get-financial-statements'/);
  assert.match(main,/periodId/);
  assert.match(main,/buildFinancialStatements/);
  assert.match(preload,/accountingGetFinancialStatements/);
});

test('la interfaz permite consultar el mayor y estados financieros con filtros explícitos',()=>{
  for(const id of ['accLedgerAccount','accLedgerStart','accLedgerEnd','btnLoadGeneralLedger','accStatementsPeriod','btnLoadFinancialStatements','accGeneralLedger','accFinancialStatements']) {
    assert.ok(ui.includes('id="'+id+'"'),'falta '+id);
  }
  assert.match(ui,/accountingGetGeneralLedger/);
  assert.match(ui,/accountingGetFinancialStatements/);
});
