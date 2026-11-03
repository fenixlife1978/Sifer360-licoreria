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
    "Lotes cerrados y conciliados sin diferencias"
  ]) assert.ok(!main.includes(phrase), "Se detectó afirmación fiscal no sustentada: " + phrase);
  assert.ok(html.includes("SENIAT / SUDEBAN: Revisión pendiente"));
});

test("no precarga rangos, imprentas, seriales o providencias ficticias como datos reales", () => {
  assert.ok(!main.includes("c.ctrlRangoDesde||'00-00000001'"));
  assert.ok(!main.includes("c.ctrlRangoHasta||'00-00050000'"));
  assert.ok(!main.includes("c.imprentaRif||'J-31009988-4'"));
  assert.ok(!main.includes("c.imprentaAut||'SENIAT/DAF/2022/981'"));
  assert.ok(!main.includes("c.serialFiscal||'Z4A7719204'"));
  assert.ok(!main.includes("S.cfg.provEspecial||'SNAT/2023/000412'"));
  assert.ok(main.includes("const hadLegacyFiscalDemo"));
});

test("las nuevas ventas no inventan números de control ni se clasifican como factura fiscal autorizada", () => {
  assert.ok(main.includes("const ctrlNo=''"));
  assert.ok(main.includes("docType:'DOCUMENTO_INTERNO',transType:'AUXILIAR'"));
  assert.ok(!main.includes("const ctrlNo=ctrlPrefix+String(currentCaja())"));
  assert.ok(main.includes("Numeración fiscal: no configurada ni validada"));
  assert.ok(main.includes("el POS no genera números de control"));
});

test("la retención automática no presume 75% y la configuración permite 75% o 100% bajo validación", () => {
  assert.ok(main.includes("const retPct=[75,100].includes(Number(S.cfg.retIvaPct))?Number(S.cfg.retIvaPct):0"));
  assert.ok(main.includes('value="75"'));
  assert.ok(main.includes('value="100"'));
  assert.ok(main.includes("S.cfg.retIvaPct=Number($('#fPctRet',el).value)||0"));
  assert.ok(main.includes("No configurado / uso interno"));
  assert.ok(main.includes("retIvaPctConfirmed!==true"));
  assert.ok(main.includes("S.cfg.retIvaPctConfirmed=[75,100].includes(S.cfg.retIvaPct)"));
  assert.ok(main.includes("sup.ivaPerceptionAgentStatus==='no'"));
  assert.ok(main.includes("sup.retencionExclusionStatus==='eligible'"));
  assert.ok(main.includes("nsPerception"));
  assert.ok(main.includes("retieneIvaStatus"));
  assert.ok(main.includes("Por verificar"));
  assert.ok(main.includes("nsRetentionEligibility"));
  assert.ok(main.includes("retencion100PorcientoVerificada"));
  assert.ok(main.includes("nsRet100"));
  assert.ok(main.includes("Proveedor tecnológico autorizado"));
});

test("retenciones manuales son borradores sin números aleatorios ni datos precargados", () => {
  const retStart = main.indexOf("function newRetencionIvaDlg");
  const retEnd = main.indexOf("function seniatSudebanDlg", retStart);
  const retForm = main.slice(retStart, retEnd);
  assert.ok(retForm.includes("BORRADOR-RET-"));
  assert.ok(!retForm.includes("Math.random"));
  assert.ok(!retForm.includes('value="00048912"'));
  assert.ok(retForm.includes("retIvaAmount"));
  assert.ok(main.includes("Exportación TXT deshabilitada"));
  assert.ok(main.includes("TXT oficial no habilitado"));
  assert.ok(!main.includes("COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO"));
});
