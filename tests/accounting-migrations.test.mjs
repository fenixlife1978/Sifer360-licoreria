import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
const require = createRequire(import.meta.url);
const { applyAccountingMigration } = require("../electron/accounting-migrations.cjs");

async function createSql() {
  return initSqlJs({ locateFile: file => require.resolve("sql.js/dist/" + file) });
}

test("la actualización contable conserva datos operativos existentes y es idempotente", async () => {
  const SQL = await createSql();
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE app_state(id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE app_users(username TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL); CREATE TABLE sales(id TEXT PRIMARY KEY, total_minor INTEGER NOT NULL); CREATE TABLE inventory(sku TEXT PRIMARY KEY, quantity INTEGER NOT NULL);");
  db.run("INSERT INTO app_state VALUES(1,'{\"cfg\":{\"currency\":\"VES\"},\"customers\":[{\"id\":\"C-1\"}]}','2026-11-18'); INSERT INTO app_users VALUES('admin','Administrador','admin','hash-no-real'); INSERT INTO sales VALUES('V-00001',12500); INSERT INTO inventory VALUES('SKU-1',37);");
  const schemaSql = fs.readFileSync(new URL("../src/accounting/schema.sql", import.meta.url), "utf8");
  let persistCalls = 0;
  const first = applyAccountingMigration({ db, schemaSql, persist: () => { persistCalls += 1; } });
  assert.equal(first.applied, true);
  assert.equal(persistCalls, 1);
  assert.equal(db.exec("SELECT payload FROM app_state WHERE id=1")[0].values[0][0], '{"cfg":{"currency":"VES"},"customers":[{"id":"C-1"}]}');
  assert.deepEqual(db.exec("SELECT username,name,role,password_hash FROM app_users")[0].values[0], ["admin","Administrador","admin","hash-no-real"]);
  assert.deepEqual(db.exec("SELECT id,total_minor FROM sales")[0].values[0], ["V-00001",12500]);
  assert.deepEqual(db.exec("SELECT sku,quantity FROM inventory")[0].values[0], ["SKU-1",37]);
  assert.equal(db.exec("SELECT COUNT(*) FROM schema_migrations WHERE migration_key='accounting-ven-nif-v1'")[0].values[0][0], 1);
  const second = applyAccountingMigration({ db, schemaSql, persist: () => { persistCalls += 1; } });
  assert.equal(second.applied, false);
  assert.equal(persistCalls, 1);
  assert.equal(db.exec("SELECT COUNT(*) FROM sales")[0].values[0][0], 1);
  assert.equal(db.exec("SELECT COUNT(*) FROM inventory")[0].values[0][0], 1);
  db.close();
});

test("una migración inválida se revierte completa y no persiste cambios parciales", async () => {
  const SQL = await createSql();
  const db = new SQL.Database();
  db.run("CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE customer_data(id TEXT PRIMARY KEY, value TEXT); INSERT INTO customer_data VALUES('C1','conservar');");
  let persistCalls = 0;
  assert.throws(() => applyAccountingMigration({ db, schemaSql: "CREATE TABLE should_rollback(id TEXT); INSERT INTO missing_table VALUES(1);", persist: () => { persistCalls += 1; } }), /no such table/i);
  assert.equal(persistCalls, 0);
  assert.equal(db.exec("SELECT value FROM customer_data WHERE id='C1'")[0].values[0][0], "conservar");
  assert.equal(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback'").length, 0);
  assert.equal(db.exec("SELECT COUNT(*) FROM schema_migrations")[0].values[0][0], 0);
  db.close();
});

test("se bloquean instrucciones destructivas antes de tocar la base de datos", async () => {
  const SQL = await createSql();
  const db = new SQL.Database();
  db.run("CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE customer_data(id TEXT PRIMARY KEY); INSERT INTO customer_data VALUES('C1');");
  assert.throws(() => applyAccountingMigration({ db, schemaSql: "DROP TABLE customer_data;" }), /puede eliminar o reemplazar datos/i);
  assert.equal(db.exec("SELECT COUNT(*) FROM customer_data")[0].values[0][0], 1);
  db.close();
});

test("la migración de renglones múltiples agrega lines_json sin alterar reglas anteriores", async () => {
  const SQL = await createSql();
  const db = new SQL.Database();
  db.run("CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE accounting_automation_rules(id TEXT PRIMARY KEY, amount_path TEXT NOT NULL, debit_account_code TEXT NOT NULL, credit_account_code TEXT NOT NULL); INSERT INTO accounting_automation_rules VALUES('R-1','total','1.1.1.01','4.1.1.01');");
  const schemaSql = fs.readFileSync(new URL("../src/accounting/automation-lines-schema.sql", import.meta.url), "utf8");
  const first = applyAccountingMigration({ db, schemaSql, migrationKey:'accounting-automation-lines-v1' });
  assert.equal(first.applied, true);
  const columns = db.exec("PRAGMA table_info(accounting_automation_rules)")[0].values.map(row => row[1]);
  assert.ok(columns.includes('lines_json'));
  assert.equal(db.exec("SELECT id,amount_path,lines_json FROM accounting_automation_rules")[0].values[0][0], 'R-1');
  assert.equal(db.exec("SELECT lines_json FROM accounting_automation_rules WHERE id='R-1'")[0].values[0][0], '');
  const second = applyAccountingMigration({ db, schemaSql, migrationKey:'accounting-automation-lines-v1' });
  assert.equal(second.applied, false);
  db.close();
});
