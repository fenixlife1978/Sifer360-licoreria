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

function assertAccountingPeriodCanClose({ period, draftCount = 0, unresolvedEventCount = 0, invalidEntryCount = 0, missingPresentationCount = 0 }) {
  if (!period) throw new Error('El período contable no existe.');
  if (period.status !== 'open') throw new Error('El período ya está cerrado.');
  const checks = [
    [draftCount, 'Hay asientos en borrador o pendientes de aprobación.'],
    [unresolvedEventCount, 'Hay operaciones de origen pendientes o que requieren revisión.'],
    [invalidEntryCount, 'Hay asientos contabilizados con renglones incompletos o descuadrados.'],
    [missingPresentationCount, 'Hay asientos sin importes de moneda de presentación.'],
    [pendingAssetDepreciationCount, 'Hay activos fijos con depreciación pendiente o meses anteriores sin contabilizar.']
  ];
  for (const [value, message] of checks) if (safeCount(value) > 0) throw new Error(message);
  return true;
}

function assertAccountingPeriodWritable(period, entryDate) {
  if (!period) throw new Error('El período contable no existe.');
  if (period.status !== 'open') throw new Error('El período contable está cerrado; no admite nuevos asientos.');
  if (entryDate) {
    const startDate = String(period.startDate ?? period.start_date ?? '');
    const endDate = String(period.endDate ?? period.end_date ?? '');
    if (String(entryDate) < startDate || String(entryDate) > endDate) throw new Error('La fecha del asiento está fuera del período contable abierto.');
  }
  return true;
}
module.exports = { assertAccountingSettingsChange, assertAccountingPeriodChange, assertAccountingPeriodCanClose, assertAccountingPeriodWritable };
