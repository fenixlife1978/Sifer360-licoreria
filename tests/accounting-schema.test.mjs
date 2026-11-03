import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
const require = createRequire(import.meta.url);
test("el esquema contable se crea en SQLite y activa restricciones de integridad", async () => {
  const SQL = await initSqlJs({ locateFile: file => require.resolve("sql.js/dist/" + file) });
  const db = new SQL.Database();
  db.run(fs.readFileSync(new URL("../src/accounting/schema.sql", import.meta.url), "utf8"));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(tables[0].values.map(row => row[0]));
  for (const name of ["accounting_settings","accounting_periods","accounting_exchange_rates","chart_of_accounts","fiscal_entity_profile","fiscal_document_series","alcohol_product_profiles","alcohol_traceability_movements","tax_rule_sets","tax_rules","journal_entries","journal_lines","accounting_source_events","accounting_audit_log"]) assert.ok(names.has(name), "Falta tabla " + name);
  const triggers = db.exec("SELECT name FROM sqlite_master WHERE type='trigger'");
  assert.ok(triggers[0].values.length >= 3, "No se instalaron las salvaguardas de inmutabilidad");
  db.run("INSERT INTO accounting_periods(id,label,start_date,end_date) VALUES('2026-11','Noviembre 2026','2026-11-01','2026-11-30')");
  db.run("INSERT INTO accounting_settings(id,policy_version,updated_at) VALUES(1,'pending-review','now')");
  const settings = db.exec("SELECT accounting_framework,functional_currency,presentation_currency FROM accounting_settings WHERE id=1");
  assert.deepEqual(settings[0].values[0], [null, null, null], "No debe presumirse VEN-NIF PYME ni moneda funcional VES");
  db.run("INSERT INTO chart_of_accounts(code,name,account_type,normal_balance,created_at,updated_at) VALUES('1.1','Caja','asset','debit','now','now')");
  db.run("INSERT INTO journal_entries(id,source_type,source_id,entry_date,period_id,functional_currency,rule_version,status,debit_minor,credit_minor,created_at) VALUES('A1','sale','V1','2026-11-03','2026-11','VES','v1','posted',100,100,'now')");
  assert.throws(() => db.run("DELETE FROM journal_entries WHERE id='A1'"), /No se permite borrar asientos/);
  db.close();
});

test("la cola de eventos de origen conserva idempotencia y estados permitidos", async () => {
  const SQL = await initSqlJs({ locateFile: file => require.resolve("sql.js/dist/" + file) });
  const db = new SQL.Database();
  db.run(fs.readFileSync(new URL("../src/accounting/schema.sql", import.meta.url), "utf8"));
  const insert = "INSERT OR IGNORE INTO accounting_source_events(event_id,source_type,source_id,event_type,occurred_at,payload_hash,payload_json) VALUES(?,?,?,?,?,?,?)";
  const row = ["evt-1","sale","Caja 01:V-1","created.abcd","2026-11-03T10:00:00.000Z","hash-1",JSON.stringify({ action: "created" })];
  db.run(insert, row);
  db.run(insert, row);
  const count = db.exec("SELECT COUNT(*) FROM accounting_source_events");
  assert.equal(count[0].values[0][0], 1);
  assert.equal(db.exec("SELECT processing_status FROM accounting_source_events WHERE event_id='evt-1'")[0].values[0][0], "pending");
  assert.throws(() => db.run("UPDATE accounting_source_events SET processing_status='invented' WHERE event_id='evt-1'"));
  db.close();
});
