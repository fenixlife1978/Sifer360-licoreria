import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");

test("las operaciones contables usan IPC acotado y validan el origen del renderer", () => {
  for (const channel of ["accounting:get-settings","accounting:save-settings","accounting:get-profile","accounting:save-profile","accounting:list-periods","accounting:save-period","accounting:list-source-events","accounting:source-event-summary"]) {
    assert.ok(main.includes("ipcMain.handle('" + channel + "'"), "Falta IPC " + channel);
  }
  assert.ok(!preload.includes("ipcRenderer:"));
  assert.ok(preload.includes("accountingSaveSettings: settings => ipcRenderer.invoke('accounting:save-settings', settings)"));
  assert.ok(preload.includes("accountingListSourceEvents: () => ipcRenderer.invoke('accounting:list-source-events')"));
});

test("los cambios de configuración generan auditoría y evitan solapamiento de períodos", () => {
  assert.ok(main.includes("INSERT INTO accounting_audit_log"));
  assert.ok(main.includes("BEGIN IMMEDIATE"));
  assert.ok(main.includes("El período se solapa con el período contable"));
  assert.ok(main.includes("Un período cerrado no puede modificarse."));
  assert.ok(main.includes("La clasificación especial debe coincidir con la notificación expresa verificada."));
  assert.ok(main.includes("startDate.slice(0,7)!==id"));
  assert.ok(main.includes("No se puede activar agente de retención IVA sin designación especial confirmada."));
});

test("las operaciones POS y sus eventos contables se capturan en la misma transacción", () => {
  assert.ok(main.includes("buildAccountingSourceEvents(previousState, state"));
  assert.ok(main.includes("insertAccountingSourceEvents(accountingEvents)"));
  assert.ok(main.includes("Operación comercial y su evento contable se escriben juntos"));
  assert.ok(main.includes("insertAccountingSourceEvents(buildAccountingSourceEvents(state, nextState"));
  assert.ok(main.includes("const accountingEvents = buildAccountingSourceEvents(current, merged"));
  assert.ok(renderer.includes("const result = await window.posDesktop.saveState(state)"));
  assert.ok(renderer.includes("SQLite no confirmó el guardado del estado POS."));
});

test("la interfaz muestra eventos pendientes sin presentarlos como asientos", () => {
  assert.ok(renderer.includes("Contabilidad VEN-NIF"));
  assert.ok(renderer.includes("Operaciones recibidas por el motor contable"));
  assert.ok(renderer.includes("Pendientes:"));
  assert.ok(renderer.includes("todavía no generan asientos"));
  assert.ok(renderer.includes("btnSaveAccountingSettings"));
  assert.ok(renderer.includes("btnSaveFiscalProfile"));
  assert.ok(renderer.includes("btnSaveAccountingPeriod"));
});
