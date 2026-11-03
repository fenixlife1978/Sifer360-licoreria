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
