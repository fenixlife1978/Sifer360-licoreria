import test from "node:test";
import assert from "node:assert/strict";
import { convertMinorUnits, buildBimonetaryLines, decimalRateToRational } from "../src/accounting/bimonetary.mjs";
import { reverseJournalEntry } from "../src/accounting/engine.mjs";

test("convierte VES a USD usando tasa racional exacta y redondeo half-up", () => {
  assert.equal(convertMinorUnits(8747320, { rateNumerator: 1, rateDenominator: 874732, fromDecimals: 2, toDecimals: 2 }), 10);
  assert.equal(convertMinorUnits(875, { rateNumerator: 1, rateDenominator: 2, fromDecimals: 2, toDecimals: 2 }), 438);
});

test("conserva igualdad Debe/Haber en ambas monedas", () => {
  const result = buildBimonetaryLines({
    functionalCurrency: "VES", presentationCurrency: "USD",
    rateNumerator: 1, rateDenominator: 874732,
    lines: [
      { accountCode: "1.1", debitMinor: 87473200, creditMinor: 0 },
      { accountCode: "4.1", debitMinor: 0, creditMinor: 87473200 }
    ]
  });
  assert.equal(result.functionalDebitMinor, 87473200);
  assert.equal(result.functionalCreditMinor, 87473200);
  assert.equal(result.presentationDebitMinor, 100);
  assert.equal(result.presentationCreditMinor, 100);
});

test("rechaza tasa ausente, cero, monedas inválidas y asientos descuadrados", () => {
  const lines = [
    { accountCode: "1.1", debitMinor: 10000, creditMinor: 0 },
    { accountCode: "4.1", debitMinor: 0, creditMinor: 10000 }
  ];
  assert.throws(() => buildBimonetaryLines({ functionalCurrency: "VES", presentationCurrency: "USD", lines, rateNumerator: 0, rateDenominator: 1 }), /entero positivo/);
  assert.throws(() => buildBimonetaryLines({ functionalCurrency: "VE", presentationCurrency: "USD", lines }), /ISO 4217/);
  assert.throws(() => buildBimonetaryLines({ functionalCurrency: "VES", presentationCurrency: "USD", lines: [lines[0], { ...lines[1], creditMinor: 9999 }], rateNumerator: 1, rateDenominator: 1 }), /no cuadra/);
});

test("no oculta diferencias por redondeo entre renglones", () => {
  assert.throws(() => buildBimonetaryLines({
    functionalCurrency: "VES", presentationCurrency: "USD",
    rateNumerator: 1, rateDenominator: 3,
    lines: [
      { accountCode: "1.1", debitMinor: 1, creditMinor: 0 },
      { accountCode: "1.2", debitMinor: 1, creditMinor: 0 },
      { accountCode: "4.1", debitMinor: 0, creditMinor: 2 }
    ]
  }), /diferencia en moneda de presentación/);
});

test("interpreta tasas decimales sin errores de coma flotante", () => {
  assert.deepEqual(decimalRateToRational("0,001143"), { rateNumerator: 1143, rateDenominator: 1000000 });
  assert.deepEqual(decimalRateToRational("874.7321"), { rateNumerator: 8747321, rateDenominator: 10000 });
  assert.throws(() => decimalRateToRational("0"), /mayor que cero/);
});

test("el reverso conserva la tasa y revierte los importes de presentación", () => {
  const original = {
    id: "J-001", sourceType: "manual", sourceId: "J-001", entryDate: "2026-11-03",
    periodId: "2026-11", currency: "VES", presentationCurrency: "USD",
    exchangeRateId: "FX-001", exchangeRateNumerator: 1, exchangeRateDenominator: 874732,
    exchangeRateType: "official", exchangeRateSource: "BCV · referencia 2026-11-03",
    presentationDebitMinor: 100, presentationCreditMinor: 100,
    ruleVersion: "VEN-NIF-v1", description: "Asiento original", status: "posted",
    debitMinor: 87473200, creditMinor: 87473200,
    lines: [
      { accountCode: "1.1", debitMinor: 87473200, creditMinor: 0, presentationDebitMinor: 100, presentationCreditMinor: 0 },
      { accountCode: "4.1", debitMinor: 0, creditMinor: 87473200, presentationDebitMinor: 0, presentationCreditMinor: 100 }
    ]
  };
  const reversal = reverseJournalEntry(original, {
    id: "REV-001", reason: "Corrección documentada", actorId: "contador-1",
    reversalDate: "2026-11-04", reversalPeriodId: "2026-11"
  });
  assert.equal(reversal.reversesEntryId, "J-001");
  assert.equal(reversal.exchangeRateId, "FX-001");
  assert.equal(reversal.exchangeRateNumerator, 1);
  assert.equal(reversal.exchangeRateDenominator, 874732);
  assert.equal(reversal.presentationDebitMinor, 100);
  assert.equal(reversal.presentationCreditMinor, 100);
  assert.equal(reversal.lines[0].presentationCreditMinor, 100);
  assert.equal(reversal.lines[1].presentationDebitMinor, 100);
});

test("rechaza renglones inválidos y sumas fuera del rango entero seguro", () => {
  assert.throws(() => buildBimonetaryLines({
    functionalCurrency: "VES", presentationCurrency: "USD",
    lines: [
      { accountCode: "1.1", debitMinor: 10, creditMinor: 1 },
      { accountCode: "4.1", debitMinor: 0, creditMinor: 11 }
    ]
  }), /nunca ambos/);
  assert.throws(() => buildBimonetaryLines({
    functionalCurrency: "VES", presentationCurrency: "USD",
    lines: [
      { accountCode: "1.1", debitMinor: Number.MAX_SAFE_INTEGER, creditMinor: 0 },
      { accountCode: "1.2", debitMinor: 1, creditMinor: 0 },
      { accountCode: "4.1", debitMinor: 0, creditMinor: Number.MAX_SAFE_INTEGER },
      { accountCode: "4.2", debitMinor: 0, creditMinor: 1 }
    ]
  }), /rango seguro/);
});
