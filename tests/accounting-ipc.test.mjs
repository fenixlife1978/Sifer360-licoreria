import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");

test("las operaciones contables usan IPC acotado y validan el origen del renderer", () => {
  assert.ok(main.includes("function assertTrustedAccountingSender(event)"));
  assert.ok(main.includes("assertTrustedAccountingSender(event)"));
  assert.ok(main.includes("ipcMain.handle('accounting:get-settings'"));
  assert.ok(main.includes("ipcMain.handle('accounting:save-settings'"));
  assert.ok(main.includes("ipcMain.handle('accounting:get-profile'"));
  assert.ok(main.includes("ipcMain.handle('accounting:save-profile'"));
  assert.ok(main.includes("ipcMain.handle('accounting:list-periods'"));
  assert.ok(main.includes("ipcMain.handle('accounting:save-period'"));
  assert.ok(!preload.includes("ipcRenderer:"));
  assert.ok(preload.includes("accountingSaveSettings: settings => ipcRenderer.invoke('accounting:save-settings', settings)"));
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

test("la interfaz advierte que la configuración no activa asientos automáticos", () => {
  assert.ok(renderer.includes("Contabilidad VEN-NIF"));
  assert.ok(renderer.includes("No se selecciona automáticamente la moneda funcional"));
  assert.ok(renderer.includes("Las operaciones del POS aún no se contabilizan automáticamente."));
  assert.ok(renderer.includes("btnSaveAccountingSettings"));
  assert.ok(renderer.includes("btnSaveFiscalProfile"));
  assert.ok(renderer.includes("btnSaveAccountingPeriod"));
});
