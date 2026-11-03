import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const main = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
test("el panel fiscal no presenta conformidad ni conciliaciones no verificadas como hechos", () => {
  for (const phrase of [
    "CONTROL FISCAL & SUDEBAN CONFORME",
    "SENIAT &middot; SUDEBAN OK",
    "48.958 RESTANTES",
    "100% CONFORME BCV",
    "CONCILIACIÓN FÍSICA Y ELECTRÓNICA CONFORME",
    "Lotes cerrados y conciliados sin diferencias",
    "J-31009988-4",
    "SENIAT/DAF/2022/981",
    "SNAT/2023/000412",
    "Z4A7719204",
    "00-00050000",
    "00-00000001"
  ]) assert.ok(!main.includes(phrase), "Se detectó afirmación fiscal no sustentada: " + phrase);
  const retStart = main.indexOf("function newRetencionIvaDlg");
  const retEnd = main.indexOf("function seniatSudebanDlg", retStart);
  const retForm = main.slice(retStart, retEnd);
  assert.ok(retForm.includes("BORRADOR-RET-"));
  assert.ok(!retForm.includes("Math.random"));
  assert.ok(!retForm.includes('value="00048912"'));
  assert.ok(main.includes("Exportación TXT deshabilitada"));
  assert.ok(main.includes("TXT oficial no habilitado"));
  assert.ok(!main.includes("COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO"));
  assert.ok(html.includes("SENIAT / SUDEBAN: Revisión pendiente"));
});
