import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const builder = JSON.parse(fs.readFileSync(new URL("../electron-builder.json", import.meta.url), "utf8"));
const channels = [
  "accounting:get-settings","accounting:save-settings","accounting:get-profile","accounting:save-profile",
  "accounting:list-source-events","accounting:mark-source-event-review","accounting:source-event-summary",
  "accounting:list-periods","accounting:save-period","accounting:list-journal-entries","accounting:list-exchange-rates",
  "accounting:get-trial-balance","accounting:create-journal-entry","accounting:approve-journal-entry",
  "accounting:post-journal-entry","accounting:create-reversal-draft","accounting:list-accounts","accounting:save-account"
];

test("todos los IPC contables exigen origen permitido y sesión vigente", () => {
  for (const channel of channels) {
    const start = main.indexOf("ipcMain.handle('" + channel + "'");
    assert.ok(start >= 0, "Falta " + channel);
    const end = main.indexOf("\n  });", start);
    const block = main.slice(start, end < 0 ? main.length : end);
    assert.ok(block.includes("assertTrustedAccountingSender(event)"), channel + " no valida el origen");
    assert.ok(block.includes("requireAccountingSession(token") || block.includes("accountingActor(input)"), channel + " no valida sesión");
  }
  assert.ok(main.includes("function accountingActor(input) {\n  return requireAccountingSession(String(input && input.token || ''), { allowedRoles: ['admin', 'contador'] });"));
  assert.ok(!main.includes("const actorId = String(input && input.actorId"));
  assert.ok(!main.includes("const actorRole = String(input && input.actorRole"));
  assert.ok(main.includes("findActiveUser: username => one('SELECT username,name,role,cashbox,active FROM app_users WHERE username=? COLLATE NOCASE AND active=1'"));
  assert.ok(main.includes("registerAccountingIpc();"));
});

test("los métodos preload reciben el token de sesión explícitamente", () => {
  for (const method of ["accountingGetSettings: token =>","accountingListPeriods: token =>","accountingListAccounts: token =>","accountingListJournalEntries: token =>","accountingGetTrialBalance: token =>"]) {
    assert.ok(preload.includes(method), "Falta token en " + method);
  }
  assert.ok(preload.includes("accountingSaveSettings: (token, settings)"));
  assert.ok(preload.includes("accountingCreateJournalEntry: (token, entry)"));
  assert.ok(preload.includes("accountingApproveJournalEntry: (token, entry)"));
});

test("los clientes LAN reenvían contabilidad al servidor y nunca ejecutan el handler en SQLite local", () => {
  assert.ok(main.includes("if (networkConfig.role === 'client') {"));
  assert.ok(main.includes("clientApi('/api/accounting/' + encodeURIComponent(channel.slice('accounting:'.length))"));
  assert.ok(main.includes("url.pathname.startsWith('/api/accounting/') && req.method === 'POST'"));
  assert.ok(main.includes("const handler = accountingIpcHandlers.get(channel)"));
  assert.ok(main.includes("hasValidBearerToken(req.headers.authorization, networkConfig.token)"));
  assert.ok(main.includes("await handler(sender, String(payload.token || ''))"));
  assert.ok(!main.includes("Contabilidad en clientes LAN requiere el canal autenticado"));
});

test("las operaciones POS y la sincronización LAN capturan eventos contables junto al estado comercial", () => {
  assert.ok(main.includes("buildAccountingSourceEvents(previousState, state"));
  assert.ok(main.includes("insertAccountingSourceEvents(accountingEvents)"));
  assert.ok(main.includes("buildAccountingSourceEvents(current, merged"));
  assert.ok(main.includes("persistMutation(() => {\n      run('INSERT INTO app_state"));
});

test("el instalador no elimina el directorio de datos del usuario", () => {
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.ok(builder.files.includes("src/accounting/**/*"));
});
