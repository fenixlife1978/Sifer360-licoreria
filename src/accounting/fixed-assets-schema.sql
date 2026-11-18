-- Auxiliar de activos fijos conectado al mayor VEN-NIF.
CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
  id TEXT PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acquisition_date TEXT NOT NULL,
  available_for_use_date TEXT NOT NULL,
  depreciation_start_month TEXT NOT NULL,
  cost_minor INTEGER NOT NULL CHECK(cost_minor>0),
  residual_minor INTEGER NOT NULL DEFAULT 0 CHECK(residual_minor>=0 AND residual_minor<cost_minor),
  useful_life_months INTEGER NOT NULL CHECK(useful_life_months BETWEEN 1 AND 1200),
  functional_currency TEXT NOT NULL,
  asset_account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  accumulated_depreciation_account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  depreciation_expense_account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  acquisition_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disposed','retired')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK(acquisition_date<=available_for_use_date),
  CHECK(substr(depreciation_start_month,1,7)>=substr(available_for_use_date,1,7)),
  UNIQUE(acquisition_entry_id,asset_account_code,cost_minor)
);
CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_status
  ON accounting_fixed_assets(status,depreciation_start_month);
CREATE TABLE IF NOT EXISTS accounting_asset_depreciations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES accounting_fixed_assets(id),
  period_id TEXT NOT NULL REFERENCES accounting_periods(id),
  depreciation_month TEXT NOT NULL,
  depreciation_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  presentation_amount_minor INTEGER NOT NULL CHECK(presentation_amount_minor>0),
  journal_entry_id TEXT NOT NULL UNIQUE REFERENCES journal_entries(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','reversed')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE(asset_id,depreciation_month)
);
CREATE INDEX IF NOT EXISTS idx_accounting_asset_depreciations_period
  ON accounting_asset_depreciations(period_id,status);
