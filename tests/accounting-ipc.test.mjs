import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");

test("las operaciones contables usan IPC acotado y validan el origen del renderer", () => {
  const channels = ["accounting:get-settings","accounting:save-settings","accounting:get-profile","accounting:save-profile","accounting:list-periods","accounting:save-period","accounting:list-source-events","accounting:source-event-summary","accounting:mark-source-event-review","accounting:list-accounts","accounting:save-account"];
  for (const channel of channels) assert.ok(main.includes("ipcMain.handle('" + channel + "'"), "Falta IPC " + channel);
  assert.ok(!preload.includes("ipcRenderer:"));
  assert.ok(preload.includes("accountingSaveSettings: settings => ipcRenderer.invoke('accounting:save-settings', settings)"));
  assert.ok(preload.includes("accountingListSourceEvents: () => ipcRenderer.invoke('accounting:list-source-events')"));
  assert.ok(preload.includes("accountingMarkSourceEventReview: review => ipcRenderer.invoke('accounting:mark-source-event-review', review)"));
  assert.ok(preload.includes("accountingSaveAccount: account => ipcRenderer.invoke('accounting:save-account', account)"));
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

test("la revisión manual de eventos exige motivo y deja auditoría", () => {
  assert.ok(main.includes("mark_needs_review"));
  assert.ok(main.includes("Solo se pueden marcar eventos pendientes o ya en revisión."));
  assert.ok(main.includes("Selecciona el evento e indica el motivo de revisión."));
  assert.ok(renderer.includes("data-source-event-review"));
  assert.ok(renderer.includes("accountingMarkSourceEventReview"));
});

test("el plan de cuentas es configurable, jerárquico y protegido", () => {
  assert.ok(main.includes("La cuenta padre debe existir, estar activa y ser de agrupación."));
  assert.ok(main.includes("La cuenta hija debe conservar la misma clasificación"));
  assert.ok(main.includes("La jerarquía produciría un ciclo de cuentas."));
  assert.ok(main.includes("No se puede cambiar clasificación, saldo normal o jerarquía"));
  assert.ok(main.includes("No se puede inactivar una cuenta que conserva subcuentas activas."));
  assert.ok(main.includes("La cuenta hija no puede tener un alcance VEN-NIF más amplio que su cuenta padre."));
  assert.ok(main.includes("Primero configura y documenta el marco VEN-NIF"));
  assert.ok(renderer.includes("Plan de cuentas VEN-NIF"));
  assert.ok(renderer.includes("btnSaveAccountingAccount"));
  assert.ok(renderer.includes("accountingListAccounts()"));
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

test("la replicación LAN espera confirmación del guardado SQLite", () => {
  const saveStart = renderer.indexOf("function save(){");
  const saveEnd = renderer.indexOf("\n}", saveStart) + 2;
  const saveBlock = renderer.slice(saveStart, saveEnd);
  assert.ok(saveBlock.includes("return posSqliteDriver.saveState(state).then"));
  assert.ok(saveBlock.indexOf("captureNewOperations()") > saveBlock.indexOf("if(!result||result.ok!==true)"));
  assert.ok(saveBlock.indexOf("scheduleNetworkSync()") > saveBlock.indexOf("if(!result||result.ok!==true)"));
});
