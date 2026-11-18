import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../src/accounting/automation-schema.sql', import.meta.url), 'utf8');

test('las reglas contables son versionadas, inmutables por versión y ligadas a cuentas reales', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS accounting_automation_rules/);
  assert.match(schema, /REFERENCES chart_of_accounts\(code\)/);
  assert.match(schema, /UNIQUE\(source_type,event_action,rule_version\)/);
  assert.match(schema, /WHERE status='active'/);
  assert.match(main, /UPDATE accounting_automation_rules SET status='retired'/);
  assert.match(main, /MAX\(rule_version\)/);
});

test('la generación solo admite altas, importes positivos, moneda funcional y período abierto', () => {
  assert.match(main, /payload\.action !== 'created'/);
  assert.match(main, /amountMinor <= 0/);
  assert.match(main, /currency !== settings\.functional_currency/);
  assert.match(main, /period\.status !== 'open'/);
  assert.match(main, /buildBimonetaryLines/);
  assert.match(main, /No existe una tasa .* documentada para la fecha del evento/);
});

test('los borradores se guardan con vínculo de evento y auditoría en la misma transacción SQLite', () => {
  assert.match(main, /BEGIN IMMEDIATE/);
  assert.match(main, /insertJournalEntry\(entry\)/);
  assert.match(main, /processing_status='processed',journal_entry_id=\?,processed_at=\?/);
  assert.match(main, /'generate_draft'/);
  assert.match(main, /persistAccountingDb\(snapshot\)/);
  const generator = main.slice(main.indexOf("registerAccountingHandler('accounting:generate-source-drafts'"), main.indexOf("registerAccountingHandler('accounting:save-account'"));
  assert.doesNotMatch(generator, /status='approved'|status='posted'/);
});

test('un borrador preexistente se reconcilia de forma durable e idempotente', () => {
  const generator = main.slice(main.indexOf("registerAccountingHandler('accounting:generate-source-drafts'"), main.indexOf("registerAccountingHandler('accounting:save-account'"));
  assert.match(generator, /reconcile_existing_draft/);
  assert.match(generator, /persistAccountingDb\(snapshot\)/);
});

test('IPC expone consulta, versionado y generación protegidos por sesión', () => {
  assert.match(main, /'accounting:list-automation-rules'/);
  assert.match(main, /'accounting:save-automation-rule'/);
  assert.match(main, /'accounting:generate-source-drafts'/);
  assert.match(preload, /accountingListAutomationRules/);
  assert.match(preload, /accountingSaveAutomationRule/);
  assert.match(preload, /accountingGenerateSourceDrafts/);
});

test('la pantalla contable permite mapear cuentas y generar borradores bajo acción expresa', () => {
  for (const id of ['accRuleSource','accRuleAmountPath','accRuleCurrencyPath','accRuleDebit','accRuleCredit','accRuleDescription','btnSaveAutomationRule','btnGenerateAccountingDrafts']) {
    assert.ok(pos.includes('id="'+id+'"'), 'falta control '+id);
  }
  assert.match(pos, /data-generate-source-draft/);
  assert.match(pos, /accountingSaveAutomationRule/);
  assert.match(pos, /accountingGenerateSourceDrafts/);
  assert.match(pos, /solo genera borradores, nunca aprueba ni contabiliza/i);
});
