import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../public/main.js", import.meta.url), "utf8");

test("las operaciones contables usan IPC acotado y validan el origen del renderer", () => {
  const channels = ["accounting:get-settings","accounting:save-settings","accounting:get-profile","accounting:save-profile","accounting:list-periods","accounting:save-period","accounting:list-source-events","accounting:source-event-summary","accounting:mark-source-event-review","accounting:list-accounts","accounting:save-account","accounting:list-journal-entries","accounting:list-exchange-rates","accounting:get-trial-balance","accounting:create-journal-entry","accounting:approve-journal-entry","accounting:post-journal-entry","accounting:create-reversal-draft"];
  for (const channel of channels) assert.ok(main.includes("ipcMain.handle('" + channel + "'"), "Falta IPC " + channel);
  assert.ok(!preload.includes("ipcRenderer:"));
  assert.ok(preload.includes("accountingSaveSettings: settings => ipcRenderer.invoke('accounting:save-settings', settings)"));
  assert.ok(preload.includes("accountingListSourceEvents: () => ipcRenderer.invoke('accounting:list-source-events')"));
  assert.ok(preload.includes("accountingListExchangeRates: () => ipcRenderer.invoke('accounting:list-exchange-rates')"));
  assert.ok(preload.includes("accountingMarkSourceEventReview: review => ipcRenderer.invoke('accounting:mark-source-event-review', review)"));
  assert.ok(preload.includes("accountingSaveAccount: account => ipcRenderer.invoke('accounting:save-account', account)"));
  assert.ok(preload.includes("accountingCreateJournalEntry: entry => ipcRenderer.invoke('accounting:create-journal-entry', entry)"));
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

test("los asientos manuales exigen balance, separación de funciones y período abierto", () => {
  assert.ok(main.includes("createJournalEntry({id,sourceType:'manual'"));
  assert.ok(main.includes("El creador del asiento no puede aprobar su propio asiento."));
  assert.ok(main.includes("La aprobación de asientos está reservada al perfil Contador."));
  assert.ok(main.includes("La contabilización está reservada al perfil Contador."));
  assert.ok(main.includes("El asiento cambió de estado antes de ser contabilizado."));
  assert.ok(main.includes("reverseJournalEntry(original"));
  assert.ok(main.includes("UPDATE journal_entries SET status='reversed'"));
  assert.ok(main.includes("accounting:get-trial-balance"));
  assert.ok(renderer.includes("Asientos manuales"));
  assert.ok(renderer.includes("btnCreateJournalEntry"));
  assert.ok(renderer.includes("data-approve-journal"));
  assert.ok(renderer.includes("data-post-journal"));
  assert.ok(renderer.includes("data-reverse-journal"));
  assert.ok(renderer.includes("Balance de comprobación"));
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

test("los asientos y el balance conservan moneda funcional y de presentación", () => {
  assert.ok(main.includes("buildBimonetaryLines"));
  assert.ok(main.includes("decimalRateToRational(input.exchangeRate)"));
  assert.ok(main.includes("exchange_rate_numerator"));
  assert.ok(main.includes("presentation_debit_minor"));
  assert.ok(main.includes("accounting_exchange_rates"));
  assert.ok(main.includes("presentationDebitMinor"));
  assert.ok(renderer.includes("accJournalExchangeRate"));
  assert.ok(renderer.includes("accJournalExchangeRateSource"));
  assert.ok(renderer.includes("accJournalPresentationCurrency"));
  assert.ok(renderer.includes("presentationCreditMinor"));
});

test("el historial de tasas expone snapshots documentados y se muestra en contabilidad", () => {
  assert.ok(main.includes("accounting:list-exchange-rates"));
  assert.ok(main.includes("formatAccountingRate(row.rateNumerator,row.rateDenominator)"));
  assert.ok(main.includes("ORDER BY rate_date DESC,recorded_at DESC LIMIT 100"));
  assert.ok(renderer.includes("accountingListExchangeRates()"));
  assert.ok(renderer.includes("accExchangeRates"));
  assert.ok(renderer.includes("rate.sourceReference"));
});

test("reutiliza tasas idénticas y rechaza referencias repetidas con valor distinto", () => {
  assert.ok(main.includes("const existingRate=one("));
  assert.ok(main.includes("rateRecordExists=true"));
  assert.ok(main.includes("if(rateId&&!rateRecordExists)"));
  assert.ok(main.includes("Documenta la corrección con una referencia distinta."));
  assert.ok(main.includes("String(existingRate.sourceName)!==sourceName"));
});
