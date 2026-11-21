import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require=createRequire(import.meta.url);
const {applyAccountingMigration}=require('../electron/accounting-migrations.cjs');
const baseSchema=fs.readFileSync(new URL('../src/accounting/schema.sql',import.meta.url),'utf8');
const transitionSchema=fs.readFileSync(new URL('../src/accounting/reversal-transition-schema.sql',import.meta.url),'utf8');

test('permite únicamente contabilizado -> reversado y mantiene inmutables todos los datos del asiento',async()=>{
  const SQL=await initSqlJs({locateFile:file=>require.resolve('sql.js/dist/'+file)});
  const db=new SQL.Database();
  db.run('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
  db.run(baseSchema);
  db.run("INSERT INTO accounting_periods(id,label,start_date,end_date,status) VALUES('2026-11','Noviembre','2026-11-01','2026-11-30','open')");
  db.run("INSERT INTO journal_entries(id,source_type,source_id,entry_date,period_id,functional_currency,rule_version,description,status,debit_minor,credit_minor,created_at,created_by,approved_at,approved_by,posted_at,posted_by) VALUES('J-1','manual','SRC-1','2026-11-18','2026-11','VES','v1','Asiento original','posted',10000,10000,'2026-11-18T10:00:00Z','conta','2026-11-18T10:01:00Z','conta','2026-11-18T10:02:00Z','conta')");
  const migration=applyAccountingMigration({db,schemaSql:transitionSchema,migrationKey:'accounting-journal-reversal-transition-v1'});
  assert.equal(migration.applied,true);
  db.run("UPDATE journal_entries SET status='reversed' WHERE id='J-1' AND status='posted'");
  assert.equal(db.exec("SELECT status FROM journal_entries WHERE id='J-1'")[0].values[0][0],'reversed');
  assert.throws(()=>db.run("UPDATE journal_entries SET description='alterado',status='reversed' WHERE id='J-1'"),/inmutable/i);
  assert.throws(()=>db.run("UPDATE journal_entries SET status='posted' WHERE id='J-1'"),/inmutable/i);
  assert.throws(()=>db.run("UPDATE journal_entries SET posted_by='otro' WHERE id='J-1'"),/inmutable/i);
  db.close();
});

test('la migración de reversos es idempotente y conserva los asientos',async()=>{
  const SQL=await initSqlJs({locateFile:file=>require.resolve('sql.js/dist/'+file)});
  const db=new SQL.Database();
  db.run('CREATE TABLE schema_migrations(migration_key TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
  db.run(baseSchema);
  db.run("INSERT INTO accounting_periods(id,label,start_date,end_date,status) VALUES('2026-11','Noviembre','2026-11-01','2026-11-30','open')");
  db.run("INSERT INTO journal_entries(id,source_type,source_id,entry_date,period_id,functional_currency,rule_version,description,status,debit_minor,credit_minor,created_at,created_by) VALUES('J-2','manual','SRC-2','2026-11-18','2026-11','VES','v1','Asiento','posted',100,100,'2026-11-18T10:00:00Z','conta')");
  applyAccountingMigration({db,schemaSql:transitionSchema,migrationKey:'accounting-journal-reversal-transition-v1'});
  const second=applyAccountingMigration({db,schemaSql:transitionSchema,migrationKey:'accounting-journal-reversal-transition-v1'});
  assert.equal(second.applied,false);
  assert.equal(db.exec("SELECT COUNT(*) FROM journal_entries")[0].values[0][0],1);
  assert.equal(db.exec("SELECT COUNT(*) FROM journal_entries WHERE status='posted'")[0].values[0][0],1);
  db.close();
});
