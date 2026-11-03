-- Esquema inicial contable VEN-NIF. Aplicar en transacción SQLite.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS accounting_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 accounting_framework TEXT NOT NULL DEFAULT 'VEN_NIF_PYME' CHECK(accounting_framework IN ('VEN_NIF_PYME','VEN_NIF_GE')),
 functional_currency TEXT NOT NULL DEFAULT 'VES', presentation_currency TEXT NOT NULL DEFAULT 'VES',
 monetary_decimals INTEGER NOT NULL DEFAULT 2 CHECK(monetary_decimals BETWEEN 0 AND 6),
 automation_mode TEXT NOT NULL DEFAULT 'supervised' CHECK(automation_mode IN ('supervised','suggest_only')),
 policy_version TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS accounting_periods (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), closed_at TEXT, closed_by TEXT,
 CHECK(start_date<=end_date)
);
CREATE TABLE IF NOT EXISTS accounting_exchange_rates (
 id TEXT PRIMARY KEY, rate_date TEXT NOT NULL, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
 rate_numerator INTEGER NOT NULL CHECK(rate_numerator>0),
 rate_denominator INTEGER NOT NULL CHECK(rate_denominator>0),
 rate_type TEXT NOT NULL CHECK(rate_type IN ('official','market','contractual','accounting_adjustment')),
 source_name TEXT NOT NULL, source_reference TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT,
 UNIQUE(rate_date,from_currency,to_currency,rate_type,source_reference)
);
CREATE INDEX IF NOT EXISTS idx_accounting_exchange_rates_date
 ON accounting_exchange_rates(rate_date,from_currency,to_currency);
CREATE TABLE IF NOT EXISTS chart_of_accounts (
 code TEXT PRIMARY KEY, parent_code TEXT REFERENCES chart_of_accounts(code), name TEXT NOT NULL,
 account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense','memorandum')),
 normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
 accepts_posting INTEGER NOT NULL DEFAULT 1 CHECK(accepts_posting IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 framework_scope TEXT NOT NULL DEFAULT 'both' CHECK(framework_scope IN ('both','VEN_NIF_PYME','VEN_NIF_GE')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fiscal_entity_profile (
 id INTEGER PRIMARY KEY CHECK(id=1),
 rif TEXT NOT NULL, legal_name TEXT NOT NULL,
 taxpayer_classification TEXT NOT NULL DEFAULT 'unknown'
   CHECK(taxpayer_classification IN ('unknown','ordinary','formal','special')),
 special_subject_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(special_subject_confirmed IN (0,1)),
 special_notice_reference TEXT, special_notice_date TEXT,
 iva_withholding_agent_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(iva_withholding_agent_confirmed IN (0,1)),
 iva_perception_agent_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(iva_perception_agent_confirmed IN (0,1)),
 business_activity_scope TEXT NOT NULL DEFAULT 'unknown'
   CHECK(business_activity_scope IN ('unknown','retail','wholesale','importer','manufacturer','producer','mixed')),
 alcohol_license_reference TEXT, municipal_license_reference TEXT,
 invoice_emission_mode TEXT NOT NULL DEFAULT 'internal_only'
   CHECK(invoice_emission_mode IN ('internal_only','official_portal','authorized_provider','fiscal_machine','contingency')),
 provider_rif TEXT, provider_authorization_reference TEXT, fiscal_machine_serial TEXT,
 valid_from TEXT, valid_to TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS fiscal_document_series (
 id TEXT PRIMARY KEY, document_type TEXT NOT NULL,
 emission_mode TEXT NOT NULL CHECK(emission_mode IN ('official_portal','authorized_provider','fiscal_machine','contingency')),
 prefix TEXT NOT NULL DEFAULT '', range_start TEXT NOT NULL, range_end TEXT NOT NULL,
 next_number TEXT NOT NULL, authorization_reference TEXT NOT NULL,
 authorized_provider_rif TEXT, fiscal_machine_serial TEXT,
 valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','blocked')),
 created_at TEXT NOT NULL, created_by TEXT,
 CHECK(valid_from<=valid_to)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_series_status
 ON fiscal_document_series(status,document_type,valid_from,valid_to);
CREATE TABLE IF NOT EXISTS alcohol_product_profiles (
 product_code TEXT PRIMARY KEY,
 species_category TEXT NOT NULL,
 origin_type TEXT NOT NULL DEFAULT 'unknown'
   CHECK(origin_type IN ('unknown','national','imported','artisanal')),
 volume_ml INTEGER CHECK(volume_ml IS NULL OR volume_ml>0),
 alcohol_degree_milli INTEGER CHECK(alcohol_degree_milli IS NULL OR alcohol_degree_milli BETWEEN 0 AND 100000),
 exemption_status TEXT NOT NULL DEFAULT 'unknown'
   CHECK(exemption_status IN ('unknown','taxable','exempt','exonerated','not_subject')),
 exemption_reference TEXT,
 producer_rif TEXT, importer_rif TEXT, supplier_rif TEXT,
 band_serial TEXT,
 band_status TEXT NOT NULL DEFAULT 'unknown'
   CHECK(band_status IN ('unknown','present','missing','not_applicable')),
 source_invoice_id TEXT, source_guide_number TEXT,
 traceability_status TEXT NOT NULL DEFAULT 'needs_review'
   CHECK(traceability_status IN ('needs_review','complete','incomplete','blocked')),
 updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_alcohol_profile_origin
 ON alcohol_product_profiles(origin_type,species_category,traceability_status);
CREATE TABLE IF NOT EXISTS alcohol_traceability_movements (
 id TEXT PRIMARY KEY, product_code TEXT NOT NULL REFERENCES alcohol_product_profiles(product_code),
 movement_type TEXT NOT NULL CHECK(movement_type IN ('purchase','sale','return','transfer','adjustment')),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_code TEXT NOT NULL, occurred_at TEXT NOT NULL,
 supplier_rif TEXT, customer_rif TEXT,
 invoice_number TEXT, guide_number TEXT, batch_number TEXT,
 band_serial TEXT, source_operation_id TEXT NOT NULL,
 document_status TEXT NOT NULL DEFAULT 'needs_review'
   CHECK(document_status IN ('needs_review','verified','missing','rejected')),
 created_at TEXT NOT NULL, created_by TEXT,
 UNIQUE(source_operation_id,product_code,movement_type)
);
CREATE INDEX IF NOT EXISTS idx_alcohol_traceability_product
 ON alcohol_traceability_movements(product_code,occurred_at);
CREATE TABLE IF NOT EXISTS tax_rule_sets (
 id TEXT PRIMARY KEY, jurisdiction TEXT NOT NULL DEFAULT 'VE', authority TEXT NOT NULL, tax_code TEXT NOT NULL,
 version TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','active','retired')), source_reference TEXT NOT NULL, source_url TEXT,
 approved_by TEXT, approved_at TEXT, UNIQUE(authority,tax_code,version), CHECK(effective_from<=effective_to)
);
CREATE TABLE IF NOT EXISTS tax_rules (
 id TEXT PRIMARY KEY, rule_set_id TEXT NOT NULL REFERENCES tax_rule_sets(id), operation_code TEXT NOT NULL,
 rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 0 AND 100000), calculation_base TEXT NOT NULL,
 exemption_condition TEXT, retention_condition TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS journal_entries (
 id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, entry_date TEXT NOT NULL,
 period_id TEXT NOT NULL REFERENCES accounting_periods(id), functional_currency TEXT NOT NULL,
 rule_version TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','posted','reversed')),
 debit_minor INTEGER NOT NULL CHECK(debit_minor>0), credit_minor INTEGER NOT NULL CHECK(credit_minor>0),
 created_at TEXT NOT NULL, created_by TEXT, approved_at TEXT, approved_by TEXT, posted_at TEXT, posted_by TEXT,
 reverses_entry_id TEXT REFERENCES journal_entries(id), UNIQUE(source_type,source_id),
 CHECK(debit_minor=credit_minor)
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date,status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period ON journal_entries(period_id,status);
CREATE TABLE IF NOT EXISTS journal_lines (
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES journal_entries(id), line_no INTEGER NOT NULL,
 account_code TEXT NOT NULL REFERENCES chart_of_accounts(code), debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
 credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor>=0), description TEXT NOT NULL DEFAULT '',
 third_party_id TEXT, cost_center TEXT, UNIQUE(entry_id,line_no),
 CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code,entry_id);
CREATE TABLE IF NOT EXISTS accounting_source_events (
 event_id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, event_type TEXT NOT NULL,
 occurred_at TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
 processing_status TEXT NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','processed','rejected','needs_review')),
 journal_entry_id TEXT REFERENCES journal_entries(id), processed_at TEXT, error_message TEXT,
 UNIQUE(source_type,source_id,event_type)
);
CREATE INDEX IF NOT EXISTS idx_accounting_events_pending ON accounting_source_events(processing_status,occurred_at);
CREATE TABLE IF NOT EXISTS accounting_audit_log (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
 actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL, reason TEXT, before_json TEXT, after_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounting_audit_entity ON accounting_audit_log(entity_type,entity_id,occurred_at);
CREATE TRIGGER IF NOT EXISTS trg_no_delete_approved_journal
BEFORE DELETE ON journal_entries WHEN OLD.status IN ('approved','posted','reversed')
BEGIN SELECT RAISE(ABORT,'No se permite borrar asientos aprobados o contabilizados; use reversos auditados.'); END;
CREATE TRIGGER IF NOT EXISTS trg_immutable_posted_journal
BEFORE UPDATE OF source_type,source_id,entry_date,period_id,functional_currency,rule_version,debit_minor,credit_minor,reverses_entry_id
ON journal_entries WHEN OLD.status IN ('posted','reversed')
BEGIN SELECT RAISE(ABORT,'Un asiento contabilizado es inmutable.'); END;
CREATE TRIGGER IF NOT EXISTS trg_immutable_active_tax_rule_set
BEFORE UPDATE OF authority,tax_code,version,effective_from,effective_to,source_reference
ON tax_rule_sets WHEN OLD.status='active'
BEGIN SELECT RAISE(ABORT,'Una regla tributaria activa no se reescribe; cree una nueva versión.'); END;
