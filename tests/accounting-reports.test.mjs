import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildGeneralLedger, buildFinancialStatements } = require('../electron/accounting-reports.cjs');

test('el mayor calcula saldo de apertura, movimientos y saldo acumulado en orden cronológico', () => {
  const result = buildGeneralLedger({
    startDate:'2026-11-01',endDate:'2026-11-30',normalBalance:'debit',
    rows:[
      {entryDate:'2026-10-31',debitMinor:10000,creditMinor:0,presentationDebitMinor:10000,presentationCreditMinor:0},
      {entryDate:'2026-11-03',debitMinor:2500,creditMinor:0,presentationDebitMinor:2500,presentationCreditMinor:0},
      {entryDate:'2026-11-05',debitMinor:0,creditMinor:700,presentationDebitMinor:0,presentationCreditMinor:700}
    ]
  });
  assert.equal(result.openingBalanceMinor,10000);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[1].runningBalanceMinor,11800);
  assert.equal(result.closingBalanceMinor,11800);
  assert.equal(result.closingPresentationBalanceMinor,11800);
});

test('el mayor marca la moneda de presentación incompleta sin inventar saldos', () => {
  const result = buildGeneralLedger({startDate:'2026-11-01',endDate:'2026-11-30',rows:[
    {entryDate:'2026-11-02',debitMinor:100,creditMinor:0,presentationDebitMinor:null,presentationCreditMinor:null}
  ]});
  assert.equal(result.presentationComplete,false);
  assert.equal(result.closingPresentationBalanceMinor,null);
});

test('los estados financieros separan saldos acumulados y resultado del período y agregan cuentas padre', () => {
  const accounts=[
    {code:'1',name:'Activos',accountType:'asset',parentCode:null,acceptsPosting:0},
    {code:'1.1',name:'Caja',accountType:'asset',parentCode:'1',acceptsPosting:1},
    {code:'2',name:'Pasivos',accountType:'liability',parentCode:null,acceptsPosting:0},
    {code:'2.1',name:'Proveedores',accountType:'liability',parentCode:'2',acceptsPosting:1},
    {code:'3',name:'Patrimonio',accountType:'equity',parentCode:null,acceptsPosting:0},
    {code:'3.1',name:'Capital',accountType:'equity',parentCode:'3',acceptsPosting:1},
    {code:'4',name:'Ingresos',accountType:'income',parentCode:null,acceptsPosting:0},
    {code:'4.1',name:'Ventas',accountType:'income',parentCode:'4',acceptsPosting:1},
    {code:'5',name:'Gastos',accountType:'expense',parentCode:null,acceptsPosting:0},
    {code:'5.1',name:'Costo',accountType:'expense',parentCode:'5',acceptsPosting:1}
  ];
  const rows=[
    {accountCode:'1.1',entryDate:'2026-10-01',debitMinor:10000,creditMinor:0},
    {accountCode:'3.1',entryDate:'2026-10-01',debitMinor:0,creditMinor:10000},
    {accountCode:'1.1',entryDate:'2026-11-05',debitMinor:5000,creditMinor:0},
    {accountCode:'2.1',entryDate:'2026-11-05',debitMinor:0,creditMinor:2000},
    {accountCode:'4.1',entryDate:'2026-11-05',debitMinor:0,creditMinor:5000},
    {accountCode:'5.1',entryDate:'2026-11-05',debitMinor:2000,creditMinor:0}
  ];
  const result=buildFinancialStatements({accounts,rows,periodStart:'2026-11-01',periodEnd:'2026-11-30'});
  assert.equal(result.balanceSheet.totalAssetsMinor,15000);
  assert.equal(result.balanceSheet.totalLiabilitiesMinor,2000);
  assert.equal(result.balanceSheet.totalEquityMinor,10000);
  assert.equal(result.incomeStatement.totalIncomeMinor,5000);
  assert.equal(result.incomeStatement.totalExpensesMinor,2000);
  assert.equal(result.incomeStatement.periodResultMinor,3000);
  assert.equal(result.balanceSheet.differenceMinor,0);
  assert.equal(result.balanceSheet.assets.find(x=>x.code==='1').balanceMinor,15000);
});

test('rechaza jerarquías cíclicas y movimientos sin cuenta de plan', () => {
  assert.throws(()=>buildFinancialStatements({
    accounts:[{code:'1',name:'A',accountType:'asset',parentCode:'2',acceptsPosting:0},{code:'2',name:'B',accountType:'asset',parentCode:'1',acceptsPosting:0}],
    rows:[{accountCode:'1',entryDate:'2026-01-01',debitMinor:1,creditMinor:0}],periodStart:'2026-01-01',periodEnd:'2026-01-31'
  }),/ciclo/);
  assert.throws(()=>buildFinancialStatements({accounts:[],rows:[{accountCode:'X',entryDate:'2026-01-01',debitMinor:1,creditMinor:0}],periodStart:'2026-01-01',periodEnd:'2026-01-31'}),/inexistente/);
});
test('el balance de situación incorpora resultados anteriores aún no cerrados y separa el resultado del período', () => {
  const accounts=[
    {code:'1',name:'Activos',accountType:'asset',parentCode:null,acceptsPosting:0},
    {code:'1.1',name:'Caja',accountType:'asset',parentCode:'1',acceptsPosting:1},
    {code:'3',name:'Patrimonio',accountType:'equity',parentCode:null,acceptsPosting:0},
    {code:'3.1',name:'Capital',accountType:'equity',parentCode:'3',acceptsPosting:1},
    {code:'4',name:'Ingresos',accountType:'income',parentCode:null,acceptsPosting:0},
    {code:'4.1',name:'Ventas',accountType:'income',parentCode:'4',acceptsPosting:1},
    {code:'5',name:'Gastos',accountType:'expense',parentCode:null,acceptsPosting:0},
    {code:'5.1',name:'Gastos operativos',accountType:'expense',parentCode:'5',acceptsPosting:1}
  ];
  const rows=[
    {accountCode:'1.1',entryDate:'2026-09-01',debitMinor:10000,creditMinor:0},
    {accountCode:'3.1',entryDate:'2026-09-01',debitMinor:0,creditMinor:10000},
    {accountCode:'1.1',entryDate:'2026-10-15',debitMinor:3000,creditMinor:0},
    {accountCode:'4.1',entryDate:'2026-10-15',debitMinor:0,creditMinor:3000},
    {accountCode:'1.1',entryDate:'2026-11-05',debitMinor:5000,creditMinor:0},
    {accountCode:'4.1',entryDate:'2026-11-05',debitMinor:0,creditMinor:5000},
    {accountCode:'5.1',entryDate:'2026-11-10',debitMinor:2000,creditMinor:0},
    {accountCode:'1.1',entryDate:'2026-11-10',debitMinor:0,creditMinor:2000}
  ];
  const result=buildFinancialStatements({accounts,rows,periodStart:'2026-11-01',periodEnd:'2026-11-30'});
  assert.equal(result.balanceSheet.totalAssetsMinor,16000);
  assert.equal(result.balanceSheet.totalEquityMinor,10000);
  assert.equal(result.balanceSheet.priorUnclosedResultMinor,3000);
  assert.equal(result.balanceSheet.periodResultMinor,3000);
  assert.equal(result.balanceSheet.unclosedAccumulatedResultMinor,6000);
  assert.equal(result.balanceSheet.differenceMinor,0);
  assert.equal(result.incomeStatement.totalIncomeMinor,5000);
  assert.equal(result.incomeStatement.totalExpensesMinor,2000);
  assert.equal(result.incomeStatement.periodResultMinor,3000);
  assert.equal(result.incomeStatement.accumulatedIncomeMinor,8000);
});
