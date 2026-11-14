function allocateCashboxSequence({ db, cashboxId, operationType, minimumValue = 1, persist, restore }) {
  const cashbox = String(cashboxId || '').trim();
  const operation = String(operationType || '').trim();
  const minimum = Math.max(1, Math.floor(Number(minimumValue) || 1));
  const allowed = new Set(['invoice','control','z','void','refund','return','cxc','cxp','cashea','movement','opening','purchase','count']);
  const periodRetention = /^retention-\d{6}$/.test(operation);
  if (!cashbox || cashbox.length > 32 || !/^[A-Za-z0-9_-]+$/.test(cashbox)) throw new Error('Caja inválida para numeración.');
  if (!allowed.has(operation) && !periodRetention) throw new Error('Tipo de operación no permitido para numeración.');
  if (!db || typeof persist !== 'function' || typeof restore !== 'function') throw new Error('No se configuró la persistencia durable de consecutivos.');

  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.run(params); } finally { statement.free(); }
  };
  const one = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); return statement.step() ? statement.getAsObject() : null; }
    finally { statement.free(); }
  };

  const databaseBefore = db.export();
  db.run('BEGIN IMMEDIATE');
  try {
    run('INSERT OR IGNORE INTO cashbox_sequences(cashbox_id,operation_type,last_value) VALUES(?,?,0)', [cashbox, operation]);
    run('UPDATE cashbox_sequences SET last_value=MAX(last_value,?)+1,updated_at=CURRENT_TIMESTAMP WHERE cashbox_id=? AND operation_type=?', [minimum - 1, cashbox, operation]);
    const row = one('SELECT last_value FROM cashbox_sequences WHERE cashbox_id=? AND operation_type=?', [cashbox, operation]);
    db.run('COMMIT');
    try { persist(); }
    catch (error) {
      restore(databaseBefore);
      throw new Error('No se confirmó el consecutivo en disco; se restauró el estado anterior. ' + (error.message || String(error)));
    }
    return { ok: true, cashbox, operation, value: Number(row.last_value) };
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = { allocateCashboxSequence };
