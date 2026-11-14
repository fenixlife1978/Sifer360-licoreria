function migrateCashboxSequenceCategories({ db, state, persist, restore }) {
  const marker = 'cashbox-operation-sequences-v1';
  const one = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); return statement.step() ? statement.getAsObject() : null; }
    finally { statement.free(); }
  };
  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.run(params); } finally { statement.free(); }
  };
  if (one('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [marker])) return false;
  if (!db || typeof persist !== 'function' || typeof restore !== 'function') throw new Error('No se configuró la migración durable de consecutivos.');

  const databaseBefore = db.export();
  const boxes = new Set();
  const addBox = value => {
    const box = String(value || '').trim();
    if (box && box !== 'sin-caja') boxes.add(box);
  };
  const safeSequence = value => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (!Number.isSafeInteger(Math.floor(n))) throw new Error('Un consecutivo existente supera el rango seguro; se detuvo la migración para preservar los datos.');
    return Math.floor(n);
  };
  const maxFor = values => values.reduce((max, value) => Math.max(max, safeSequence(value)), 0);
  const data = state && typeof state === 'object' ? state : {};

  for (const row of db.exec("SELECT cashbox_id FROM cashbox_sequences WHERE operation_type='movement'")) {
    for (const value of row.values || []) addBox(value[0]);
  }
  for (const item of Array.isArray(data.movimientosCaja) ? data.movimientosCaja : []) addBox(item && item.cashbox);
  for (const item of Array.isArray(data.cambiosDivisas) ? data.cambiosDivisas : []) addBox(item && item.cashbox);
  for (const item of Array.isArray(data.cxc) ? data.cxc : []) {
    addBox(item && item.cashbox);
    for (const payment of Array.isArray(item && item.payments) ? item.payments : []) addBox(payment && (payment.cashbox || item.cashbox));
  }
  for (const item of Array.isArray(data.cxp) ? data.cxp : []) {
    addBox(item && item.cashbox);
    for (const payment of Array.isArray(item && item.payments) ? item.payments : []) addBox(payment && (payment.cashbox || item.cashbox));
  }

  db.run('BEGIN IMMEDIATE');
  try {
    for (const cashbox of boxes) {
      const movementMax = maxFor((data.movimientosCaja || []).filter(item => String(item.cashbox || '') === cashbox).map(item => item.sequence));
      const exchangeMax = maxFor((data.cambiosDivisas || []).filter(item => String(item.cashbox || '') === cashbox).map(item => item.sequence));
      const cxcPaymentMax = maxFor((data.cxc || []).filter(item => String(item.cashbox || '') === cashbox).flatMap(item => (item.payments || []).filter(payment => String(payment.cashbox || cashbox) === cashbox).map(payment => payment.cashboxSequence)));
      const cxpPaymentMax = maxFor((data.cxp || []).filter(item => String(item.cashbox || '') === cashbox).flatMap(item => (item.payments || []).filter(payment => String(payment.cashbox || cashbox) === cashbox).map(payment => payment.cashboxSequence)));

      run('INSERT INTO cashbox_sequences(cashbox_id,operation_type,last_value) VALUES(?,?,?) ON CONFLICT(cashbox_id,operation_type) DO UPDATE SET last_value=excluded.last_value,updated_at=CURRENT_TIMESTAMP', [cashbox, 'movement', movementMax]);
      for (const [operation, value] of [['currency-exchange', exchangeMax], ['cxc-payment', cxcPaymentMax], ['cxp-payment', cxpPaymentMax]]) {
        run('INSERT INTO cashbox_sequences(cashbox_id,operation_type,last_value) VALUES(?,?,?) ON CONFLICT(cashbox_id,operation_type) DO UPDATE SET last_value=MAX(last_value,excluded.last_value),updated_at=CURRENT_TIMESTAMP', [cashbox, operation, value]);
      }
    }
    run('INSERT INTO schema_migrations(migration_key,applied_at) VALUES(?,CURRENT_TIMESTAMP)', [marker]);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }

  try { persist(); }
  catch (error) {
    restore(databaseBefore);
    throw new Error('No se pudo persistir la separación de consecutivos por operación; se restauró SQLite. ' + (error.message || String(error)));
  }
  return true;
}

module.exports = { migrateCashboxSequenceCategories };
