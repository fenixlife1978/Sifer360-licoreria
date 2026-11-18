-- Permite exclusivamente la transición contabilizado -> reversado.
-- Todos los demás campos del asiento deben permanecer idénticos.
DROP TRIGGER IF EXISTS trg_immutable_posted_journal_row;
CREATE TRIGGER trg_immutable_posted_journal_row
BEFORE UPDATE ON journal_entries
WHEN OLD.status IN ('posted','reversed')
 AND NOT (
   OLD.status='posted' AND NEW.status='reversed'
   AND NEW.id IS OLD.id
   AND NEW.source_type IS OLD.source_type
   AND NEW.source_id IS OLD.source_id
   AND NEW.entry_date IS OLD.entry_date
   AND NEW.period_id IS OLD.period_id
   AND NEW.functional_currency IS OLD.functional_currency
   AND NEW.rule_version IS OLD.rule_version
   AND NEW.description IS OLD.description
   AND NEW.presentation_currency IS OLD.presentation_currency
   AND NEW.exchange_rate_id IS OLD.exchange_rate_id
   AND NEW.exchange_rate_numerator IS OLD.exchange_rate_numerator
   AND NEW.exchange_rate_denominator IS OLD.exchange_rate_denominator
   AND NEW.exchange_rate_type IS OLD.exchange_rate_type
   AND NEW.exchange_rate_source IS OLD.exchange_rate_source
   AND NEW.presentation_debit_minor IS OLD.presentation_debit_minor
   AND NEW.presentation_credit_minor IS OLD.presentation_credit_minor
   AND NEW.debit_minor IS OLD.debit_minor
   AND NEW.credit_minor IS OLD.credit_minor
   AND NEW.created_at IS OLD.created_at
   AND NEW.created_by IS OLD.created_by
   AND NEW.approved_at IS OLD.approved_at
   AND NEW.approved_by IS OLD.approved_by
   AND NEW.posted_at IS OLD.posted_at
   AND NEW.posted_by IS OLD.posted_by
   AND NEW.reverses_entry_id IS OLD.reverses_entry_id
 )
BEGIN
  SELECT RAISE(ABORT,'Un asiento contabilizado es inmutable; solo se permite el cambio de estado a reversado mediante reverso auditado.');
END;
