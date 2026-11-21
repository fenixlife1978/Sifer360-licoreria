'use strict';

function safeAdd(total, value) {
  const result = total + Number(value || 0);
  if (!Number.isSafeInteger(result)) throw new Error('El saldo contable excede el rango entero seguro.');
  return result;
}

function buildGeneralLedger({ rows, startDate, endDate, normalBalance = 'debit' }) {
  if (!Array.isArray(rows) || startDate > endDate) throw new Error('Parámetros del mayor inválidos.');
  let openingDebitMinor = 0, openingCreditMinor = 0;
  let openingPresentationDebitMinor = 0, openingPresentationCreditMinor = 0;
  let presentationComplete = true;
  const movements = [];
  for (const row of rows) {
    if (row.entryDate < startDate) {
      openingDebitMinor = safeAdd(openingDebitMinor, row.debitMinor);
      openingCreditMinor = safeAdd(openingCreditMinor, row.creditMinor);
      if (row.presentationDebitMinor == null || row.presentationCreditMinor == null) presentationComplete = false;
      else {
        openingPresentationDebitMinor = safeAdd(openingPresentationDebitMinor, row.presentationDebitMinor);
        openingPresentationCreditMinor = safeAdd(openingPresentationCreditMinor, row.presentationCreditMinor);
      }
    } else if (row.entryDate <= endDate) movements.push(row);
  }
  let debitMinor = openingDebitMinor, creditMinor = openingCreditMinor;
  let presentationDebitMinor = openingPresentationDebitMinor, presentationCreditMinor = openingPresentationCreditMinor;
  const rowsWithBalance = movements.map(row => {
    debitMinor = safeAdd(debitMinor, row.debitMinor);
    creditMinor = safeAdd(creditMinor, row.creditMinor);
    if (row.presentationDebitMinor == null || row.presentationCreditMinor == null) presentationComplete = false;
    else {
      presentationDebitMinor = safeAdd(presentationDebitMinor, row.presentationDebitMinor);
      presentationCreditMinor = safeAdd(presentationCreditMinor, row.presentationCreditMinor);
    }
    const signed = debitMinor - creditMinor;
    return { ...row, runningBalanceMinor: normalBalance === 'credit' ? -signed : signed,
      runningPresentationBalanceMinor: presentationComplete ? (normalBalance === 'credit' ? presentationCreditMinor-presentationDebitMinor : presentationDebitMinor-presentationCreditMinor) : null };
  });
  const signedOpening = openingDebitMinor - openingCreditMinor;
  const signedClosing = debitMinor - creditMinor;
  return {
    startDate,endDate,openingDebitMinor,openingCreditMinor,
    openingBalanceMinor:normalBalance === 'credit' ? -signedOpening : signedOpening,
    openingPresentationBalanceMinor:presentationComplete?(normalBalance === 'credit'?openingPresentationCreditMinor-openingPresentationDebitMinor:openingPresentationDebitMinor-openingPresentationCreditMinor):null,
    rows:rowsWithBalance,debitMinor:debitMinor-openingDebitMinor,creditMinor:creditMinor-openingCreditMinor,
    closingDebitMinor:debitMinor,closingCreditMinor:creditMinor,
    closingBalanceMinor:normalBalance === 'credit' ? -signedClosing : signedClosing,
    closingPresentationBalanceMinor:presentationComplete?(normalBalance === 'credit'?presentationCreditMinor-presentationDebitMinor:presentationDebitMinor-presentationCreditMinor):null,
    presentationComplete
  };
}

function buildFinancialStatements({ accounts, rows, periodStart, periodEnd }) {
  if (!Array.isArray(accounts) || !Array.isArray(rows) || periodStart > periodEnd) throw new Error('Parámetros de estados financieros inválidos.');
  const accountMap = new Map(accounts.map(account => [String(account.code), account]));
  const totals = new Map(accounts.map(account => [String(account.code), { debitAll:0,creditAll:0,debitPeriod:0,creditPeriod:0 }]));
  for (const row of rows) {
    const code = String(row.accountCode);
    if (!accountMap.has(code)) throw new Error('Hay movimientos que apuntan a una cuenta inexistente: '+code);
    let cursor = code;
    const visited = new Set();
    while (cursor) {
      if (visited.has(cursor)) throw new Error('El plan de cuentas contiene un ciclo en '+cursor+'.');
      visited.add(cursor);
      const bucket = totals.get(cursor);
      bucket.debitAll = safeAdd(bucket.debitAll,row.debitMinor);
      bucket.creditAll = safeAdd(bucket.creditAll,row.creditMinor);
      if (row.entryDate >= periodStart && row.entryDate <= periodEnd) {
        bucket.debitPeriod = safeAdd(bucket.debitPeriod,row.debitMinor);
        bucket.creditPeriod = safeAdd(bucket.creditPeriod,row.creditMinor);
      }
      cursor = accountMap.get(cursor).parentCode || null;
    }
  }
  const byType = { asset:[],liability:[],equity:[],income:[],expense:[] };
  for (const account of accounts) {
    if (!byType[account.accountType]) continue;
    const bucket = totals.get(String(account.code));
    const movement = Number(account.acceptsPosting) === 1;
    const debit = account.accountType === 'asset' || account.accountType === 'expense';
    const periodBased = account.accountType === 'income' || account.accountType === 'expense';
    const debitValue = periodBased ? bucket.debitPeriod : bucket.debitAll;
    const creditValue = periodBased ? bucket.creditPeriod : bucket.creditAll;
    const balanceMinor = debit ? debitValue-creditValue : creditValue-debitValue;
    if (movement || balanceMinor !== 0) byType[account.accountType].push({
      code:account.code,name:account.name,parentCode:account.parentCode||null,
      isGroup:!movement,balanceMinor
    });
  }
  const movementTotals = type => byType[type].filter(row=>!row.isGroup).reduce((sum,row)=>safeAdd(sum,row.balanceMinor),0);
  const totalAssetsMinor = movementTotals('asset');
  const totalLiabilitiesMinor = movementTotals('liability');
  const totalEquityMinor = movementTotals('equity');
  const totalIncomeMinor = movementTotals('income');
  const totalExpensesMinor = movementTotals('expense');
  const periodResultMinor = totalIncomeMinor-totalExpensesMinor;
  // A balance sheet date must include every unclosed P&L balance from inception,
  // not only the selected month's result. Prior periods may not yet have a
  // formal closing entry to retained earnings.
  const accumulatedIncomeMinor = byType.income.filter(row=>!row.isGroup).reduce((sum,row)=>safeAdd(sum,
    safeAdd(totals.get(String(row.code)).creditAll,-totals.get(String(row.code)).debitAll)),0);
  const accumulatedExpensesMinor = byType.expense.filter(row=>!row.isGroup).reduce((sum,row)=>safeAdd(sum,
    safeAdd(totals.get(String(row.code)).debitAll,-totals.get(String(row.code)).creditAll)),0);
  const unclosedAccumulatedResultMinor = safeAdd(accumulatedIncomeMinor,-accumulatedExpensesMinor);
  const priorUnclosedResultMinor = safeAdd(unclosedAccumulatedResultMinor,-periodResultMinor);
  return {
    periodStart,periodEnd,
    balanceSheet:{assets:byType.asset,liabilities:byType.liability,equity:byType.equity,
      totalAssetsMinor,totalLiabilitiesMinor,totalEquityMinor,
      priorUnclosedResultMinor,periodResultMinor,unclosedAccumulatedResultMinor,
      liabilitiesEquityAndResultMinor:totalLiabilitiesMinor+totalEquityMinor+unclosedAccumulatedResultMinor,
      differenceMinor:totalAssetsMinor-totalLiabilitiesMinor-totalEquityMinor-unclosedAccumulatedResultMinor},
    incomeStatement:{income:byType.income,expenses:byType.expense,totalIncomeMinor,totalExpensesMinor,periodResultMinor,
      accumulatedIncomeMinor,accumulatedExpensesMinor,unclosedAccumulatedResultMinor}
  };
}

module.exports = { buildGeneralLedger, buildFinancialStatements };
