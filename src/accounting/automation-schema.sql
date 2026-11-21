-- Reglas de automatización contable versionadas. Solo generan borradores; nunca aprueban ni contabilizan.
CREATE TABLE IF NOT EXISTS accounting_automation_rules (
 id TEXT PRIMARY KEY,
 source_type TEXT NOT NULL,
 event_action TEXT NOT NULL CHECK(event_action='created'),
 amount_path TEXT NOT NULL,
 currency_path TEXT NOT NULL DEFAULT '',
 debit_account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
 credit_account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
 description_template TEXT NOT NULL,
 exchange_rate_type TEXT CHECK(exchange_rate_type IS NULL OR exchange_rate_type IN ('official','market','contractual','accounting_adjustment')),
 rule_version INTEGER NOT NULL CHECK(rule_version>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 UNIQUE(source_type,event_action,rule_version),
 CHECK(debit_account_code<>credit_account_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_automation_active_rule
 ON accounting_automation_rules(source_type,event_action) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_accounting_automation_source
 ON accounting_automation_rules(source_type,status);
