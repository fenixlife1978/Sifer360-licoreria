import test from "node:test";
import assert from "node:assert/strict";
import { convertMinorUnits, buildBimonetaryLines } from "../src/accounting/bimonetary.mjs";

test("convierte VES a USD usando tasa racional exacta y redondeo half-up", () => {
  assert.equal(convertMinorUnits(8747320, { rateNumerator: 1, rateDenominator: 874732, fromDecimals: 2, toDecimals: 2 }), 100);
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
  assert.equal(result.presentationDebitMinor, 10000);
  assert.equal(result.presentationCreditMinor, 10000);
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
