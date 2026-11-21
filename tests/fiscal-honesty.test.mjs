import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");

test("el panel fiscal no afirma conformidad SENIAT/SUDEBAN sin evidencia", () => {
  assert.ok(!main.includes("CONTROL FISCAL & SUDEBAN CONFORME"));
  assert.ok(!main.includes("SENIAT &middot; SUDEBAN OK"));
  assert.ok(main.includes("CONTROL FISCAL & SUDEBAN: REVISIÓN PENDIENTE"));
  assert.ok(main.includes("PENDIENTE DE VALIDACIÓN"));
});

test("los vouchers bancarios no declaran conciliación física/electrónica no comprobada", () => {
  assert.ok(!main.includes("CONCILIACIÓN FÍSICA Y ELECTRÓNICA CONFORME"));
  assert.ok(main.includes("CONCILIACIÓN FÍSICA Y ELECTRÓNICA PENDIENTE DE VALIDACIÓN"));
  assert.ok(main.includes("CONSERVAR SEGÚN EL PLAZO LEGAL APLICABLE"));
});

test("los reportes no presentan rangos de imprenta ni control fiscal ficticios", () => {
  assert.ok(!main.includes("Rango Aut. Imprenta"));
  assert.ok(main.includes("Numeración fiscal: no configurada ni validada en esta instalación. Este reporte es auxiliar."));
  assert.ok(main.includes("No sustituye factura emitida por medio autorizado"));
});

test("la carga de datos no inventa rangos o números de control para ventas y compras antiguas", () => {
  assert.ok(!main.includes("if(!S.cfg.ctrlRangoDesde)S.cfg.ctrlRangoDesde='00-00000001'"));
  assert.ok(!main.includes("if(!S.cfg.ctrlRangoHasta)S.cfg.ctrlRangoHasta='00-00050000'"));
  assert.ok(main.includes("if(!s.ctrlNo)s.ctrlNo=''"));
  assert.ok(main.includes("if(!p.ctrlProv||p.ctrlProv==='00-'+pad(p.no+4400,8))p.ctrlProv=''"));
});
