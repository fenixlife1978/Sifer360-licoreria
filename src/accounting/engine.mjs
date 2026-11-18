/**
 * Núcleo contable puro de SIFER360-LICORERIA.
 * Importes expresados como unidades menores enteras; tasas siempre explícitas.
 */
const ROLES = new Set(["contador", "super-admin"]);
function assert(ok, message) { if (!ok) throw new Error(message); }
function text(value, label) { assert(typeof value === "string" && value.trim(), label + ": es obligatorio."); }
function minor(value, label = "Importe") { assert(Number.isSafeInteger(value) && value >= 0, label + ": debe ser entero no negativo."); }

export function roundHalfUp(numerator, denominator) {
  assert(Number.isSafeInteger(numerator), "Numerador fuera de rango.");
  assert(Number.isSafeInteger(denominator) && denominator > 0, "Denominador inválido.");
  const sign = numerator < 0 ? -1 : 1, n = Math.abs(numerator);
  const q = Math.floor(n / denominator), r = n % denominator;
  return sign * (q + (r * 2 >= denominator ? 1 : 0));
}
export function decimalToMinorUnits(value, decimals = 2) {
  const raw = String(value).trim().replace(",", ".");
  assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 6, "Decimales inválidos.");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  assert(m, "Formato decimal inválido.");
  const fraction = m[3] || "";
  assert(fraction.length <= decimals, "El importe tiene más decimales que los permitidos.");
  const result = Number(m[2]) * (10 ** decimals) + Number((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  assert(Number.isSafeInteger(result), "Importe fuera de rango.");
  return m[1] ? -result : result;
}
export function minorUnitsToDecimal(value, decimals = 2) {
  assert(Number.isSafeInteger(value), "Importe inválido.");
  const factor = 10 ** decimals, sign = value < 0 ? "-" : "", n = Math.abs(value);
  return sign + Math.floor(n / factor) + (decimals ? "." + String(n % factor).padStart(decimals, "0") : "");
}
export function calculateTax({ baseMinor, rateBps, ruleId, ruleVersion, currency, effectiveDate, exempt = false }) {
  minor(baseMinor, "Base imponible"); text(currency, "Moneda"); text(effectiveDate, "Fecha");
  text(ruleId, "Regla tributaria"); text(ruleVersion, "Versión tributaria");
  assert(Number.isInteger(rateBps) && rateBps >= 0 && rateBps <= 100000, "Tasa en puntos básicos inválida.");
  const taxMinor = exempt ? 0 : roundHalfUp(baseMinor * rateBps, 10000);
  return Object.freeze({ baseMinor, rateBps: exempt ? 0 : rateBps, taxMinor, totalMinor: baseMinor + taxMinor, exempt: Boolean(exempt), currency, ruleId, ruleVersion, effectiveDate });
}
export function validateJournalLines(lines) {
  assert(Array.isArray(lines) && lines.length >= 2, "El asiento requiere al menos dos renglones.");
  let debit = 0, credit = 0;
  for (const [i, line] of lines.entries()) {
    text(line.accountCode, "Cuenta del renglón " + (i + 1));
    minor(line.debitMinor, "Debe"); minor(line.creditMinor, "Haber");
    assert((line.debitMinor > 0) !== (line.creditMinor > 0), "Cada renglón debe tener Debe o Haber, nunca ambos ni ninguno.");
    debit += line.debitMinor; credit += line.creditMinor;
    assert(Number.isSafeInteger(debit) && Number.isSafeInteger(credit), "Asiento fuera de rango.");
  }
  assert(debit > 0 && debit === credit, "Asiento descuadrado: Debe " + debit + ", Haber " + credit + ".");
  return { debitMinor: debit, creditMinor: credit };
}
export function createJournalEntry(input) {
  for (const [field, label] of [["id","ID"],["sourceType","Tipo de origen"],["sourceId","ID de origen"],["entryDate","Fecha"],["periodId","Período"],["currency","Moneda funcional"],["ruleVersion","Versión de reglas"]]) text(input[field], label);
  const totals = validateJournalLines(input.lines);
  return {
    id: input.id, sourceType: input.sourceType, sourceId: input.sourceId,
    entryDate: input.entryDate, periodId: input.periodId, currency: input.currency,
    ruleVersion: input.ruleVersion, description: String(input.description || ""),
    lines: input.lines.map(line => ({ accountCode: line.accountCode, debitMinor: line.debitMinor, creditMinor: line.creditMinor, description: String(line.description || ""), thirdPartyId: line.thirdPartyId || null, costCenter: line.costCenter || null })),
    ...totals, status: "draft", createdAt: input.createdAt || new Date().toISOString(),
    createdBy: input.createdBy || null, approvedAt: null, approvedBy: null, postedAt: null, postedBy: null, reversesEntryId: null
  };
}
export function approveJournalEntry(entry, { actorId, actorRole, approvedAt = new Date().toISOString() }) {
  assert(entry && entry.status === "draft", "Solo se aprueban asientos en borrador.");
  text(actorId, "Usuario aprobador"); assert(ROLES.has(actorRole), "La aprobación requiere rol contador o super-admin.");
  validateJournalLines(entry.lines);
  return { ...entry, status: "approved", approvedAt, approvedBy: actorId };
}
export function postJournalEntry(entry, period, { actorId, postedAt = new Date().toISOString() }) {
  assert(entry && entry.status === "approved", "El asiento debe estar aprobado.");
  text(actorId, "Usuario contabilizador");
  assert(period && period.id === entry.periodId, "Período no corresponde al asiento.");
  assert(period.status === "open", "No se puede contabilizar en un período cerrado.");
  assert(entry.entryDate >= period.startDate && entry.entryDate <= period.endDate, "Fecha fuera del período.");
  validateJournalLines(entry.lines);
  return { ...entry, status: "posted", postedAt, postedBy: actorId };
}
export function reverseJournalEntry(entry, { id, reason, actorId, reversalDate, reversalPeriodId, createdAt = new Date().toISOString() }) {
  assert(entry && entry.status === "posted", "Solo se reversan asientos contabilizados.");
  text(id, "ID del reverso"); text(reason, "Motivo"); text(actorId, "Usuario responsable");
  text(reversalDate, "Fecha del reverso"); text(reversalPeriodId, "Período abierto del reverso");
  const lines = entry.lines.map(line => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor, description: "Reverso: " + reason }));
  return { ...createJournalEntry({
    id, sourceType: "journal_reversal", sourceId: entry.id, entryDate: reversalDate,
    periodId: reversalPeriodId, currency: entry.currency, ruleVersion: entry.ruleVersion,
    description: "Reverso del asiento " + entry.id + ": " + reason, lines, createdAt, createdBy: actorId
  }), reversesEntryId: entry.id,
    presentationCurrency: entry.presentationCurrency || entry.currency,
    exchangeRateId: entry.exchangeRateId || null,
    exchangeRateNumerator: entry.exchangeRateNumerator || 1,
    exchangeRateDenominator: entry.exchangeRateDenominator || 1,
    exchangeRateType: entry.exchangeRateType || null,
    exchangeRateSource: entry.exchangeRateSource || null,
    presentationDebitMinor: entry.presentationCreditMinor ?? entry.creditMinor,
    presentationCreditMinor: entry.presentationDebitMinor ?? entry.debitMinor,
    lines: lines.map((line, index) => ({ ...line,
      presentationDebitMinor: entry.lines[index].presentationCreditMinor ?? entry.lines[index].creditMinor,
      presentationCreditMinor: entry.lines[index].presentationDebitMinor ?? entry.lines[index].debitMinor
    })) };
}
export function assertSourceNotPosted(entries, sourceType, sourceId) {
  const duplicate = entries.find(x => x.sourceType === sourceType && x.sourceId === sourceId && ["approved","posted"].includes(x.status));
  assert(!duplicate, "La operación " + sourceType + "/" + sourceId + " ya tiene asiento aprobado o contabilizado.");
  return true;
}
export function validateTaxRuleSet(ruleSet, onDate) {
  assert(ruleSet && ruleSet.status === "active", "Regla tributaria no activa.");
  text(ruleSet.id, "ID de regla"); text(ruleSet.version, "Versión"); text(ruleSet.effectiveFrom, "Inicio vigencia"); text(ruleSet.effectiveTo, "Fin vigencia");
  assert(onDate >= ruleSet.effectiveFrom && onDate <= ruleSet.effectiveTo, "Regla tributaria no vigente para la fecha.");
  assert(Array.isArray(ruleSet.rules), "Conjunto tributario sin reglas.");
  return true;
}
