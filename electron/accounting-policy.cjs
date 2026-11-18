'use strict';

function safeCount(value) {
  const count = Number(value || 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('El número de asientos existentes no es válido.');
  return count;
}

function assertAccountingSettingsChange(before, next, journalEntryCount = 0) {
  const count = safeCount(journalEntryCount);
  if (count === 0) return true;
  if (!before) throw new Error('No se puede cambiar la base contable porque ya existen asientos y no hay una configuración anterior verificable.');
  const current = {
    accountingFramework: before.accounting_framework ?? before.accountingFramework ?? null,
    functionalCurrency: before.functional_currency ?? before.functionalCurrency ?? null,
    presentationCurrency: before.presentation_currency ?? before.presentationCurrency ?? null,
    monetaryDecimals: Number(before.monetary_decimals ?? before.monetaryDecimals)
  };
  const proposed = {
    accountingFramework: next.accountingFramework ?? null,
    functionalCurrency: next.functionalCurrency ?? null,
    presentationCurrency: next.presentationCurrency ?? null,
    monetaryDecimals: Number(next.monetaryDecimals)
  };
  const changed = Object.keys(current).some(key => current[key] !== proposed[key]);
  if (changed) {
    throw new Error('No se puede cambiar el marco VEN-NIF, las monedas ni los decimales mientras existan asientos. Requiere una migración contable documentada.');
  }
  return true;
}

function assertAccountingPeriodChange(existing, next, journalEntryCount = 0) {
  if (!existing) return true;
  if (existing.status === 'closed') throw new Error('Un período cerrado no puede modificarse.');
  const count = safeCount(journalEntryCount);
  const currentStart = existing.startDate ?? existing.start_date;
  const currentEnd = existing.endDate ?? existing.end_date;
  if (count > 0 && (String(currentStart) !== String(next.startDate) || String(currentEnd) !== String(next.endDate))) {
    throw new Error('No se pueden modificar las fechas de un período que ya contiene asientos contables.');
  }
  return true;
}

module.exports = { assertAccountingSettingsChange, assertAccountingPeriodChange };
