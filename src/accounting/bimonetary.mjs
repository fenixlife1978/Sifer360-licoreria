/**
 * Conversion bimonetaria contable.
 * La tasa expresa unidades de moneda de presentación por una unidad funcional.
 * Todos los importes se manejan en unidades menores enteras; no usa floats.
 */
function assert(ok, message) { if (!ok) throw new Error(message); }
function positiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, label + " debe ser un entero positivo.");
  return BigInt(value);
}
function power10(decimals, label) {
  assert(Number.isInteger(decimals) && decimals >= 0 && decimals <= 6, label + " debe estar entre 0 y 6.");
  return 10n ** BigInt(decimals);
}
export function decimalRateToRational(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const match = /^(\d+)(?:\\.(\d{1,8}))?$/.exec(raw);
  assert(match, "La tasa debe ser un decimal positivo con hasta 8 decimales.");
  const fraction = match[2] || "";
  let numerator = BigInt(match[1] + fraction);
  let denominator = 10n ** BigInt(fraction.length);
  assert(numerator > 0n, "La tasa debe ser mayor que cero.");
  let a = numerator, b = denominator;
  while (b) { const r = a % b; a = b; b = r; }
  numerator /= a; denominator /= a;
  const n = Number(numerator), d = Number(denominator);
  assert(Number.isSafeInteger(n) && Number.isSafeInteger(d), "La tasa excede el rango seguro.");
  return { rateNumerator: n, rateDenominator: d };
}
export function convertMinorUnits(amountMinor, {
  rateNumerator, rateDenominator, fromDecimals = 2, toDecimals = 2
}) {
  assert(Number.isSafeInteger(amountMinor) && amountMinor >= 0, "El importe debe ser un entero no negativo.");
  const numerator = positiveInteger(rateNumerator, "El numerador de la tasa");
  const denominator = positiveInteger(rateDenominator, "El denominador de la tasa");
  const top = BigInt(amountMinor) * numerator * power10(toDecimals, "Decimales destino");
  const bottom = denominator * power10(fromDecimals, "Decimales origen");
  const rounded = (top + bottom / 2n) / bottom;
  const result = Number(rounded);
  assert(Number.isSafeInteger(result), "El importe convertido excede el rango seguro.");
  return result;
}
export function buildBimonetaryLines({
  lines, functionalCurrency, presentationCurrency,
  functionalDecimals = 2, presentationDecimals = 2,
  rateNumerator = 1, rateDenominator = 1
}) {
  assert(Array.isArray(lines) && lines.length >= 2, "El asiento requiere al menos dos renglones.");
  assert(typeof functionalCurrency === "string" && /^[A-Z]{3}$/.test(functionalCurrency), "Moneda funcional ISO 4217 inválida.");
  assert(typeof presentationCurrency === "string" && /^[A-Z]{3}$/.test(presentationCurrency), "Moneda de presentación ISO 4217 inválida.");
  if (functionalCurrency === presentationCurrency) {
    assert(rateNumerator === 1 && rateDenominator === 1, "Si ambas monedas son iguales, la tasa debe ser 1:1.");
  }
  const converted = lines.map((line, index) => ({
    ...line,
    presentationDebitMinor: convertMinorUnits(line.debitMinor, {
      rateNumerator, rateDenominator, fromDecimals: functionalDecimals, toDecimals: presentationDecimals
    }),
    presentationCreditMinor: convertMinorUnits(line.creditMinor, {
      rateNumerator, rateDenominator, fromDecimals: functionalDecimals, toDecimals: presentationDecimals
    })
  }));
  const functionalDebit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const functionalCredit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  const presentationDebit = converted.reduce((sum, line) => sum + line.presentationDebitMinor, 0);
  const presentationCredit = converted.reduce((sum, line) => sum + line.presentationCreditMinor, 0);
  assert(functionalDebit === functionalCredit, "El asiento no cuadra en moneda funcional.");
  assert(presentationDebit === presentationCredit,
    "El redondeo de conversión deja una diferencia en moneda de presentación. Registra un renglón explícito de ajuste por conversión antes de continuar.");
  return {
    lines: converted,
    functionalDebitMinor: functionalDebit,
    functionalCreditMinor: functionalCredit,
    presentationDebitMinor: presentationDebit,
    presentationCreditMinor: presentationCredit
  };
}
