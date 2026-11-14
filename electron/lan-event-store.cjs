function applyIncomingEvents({ db, events, persist, restore, statePayloadHash }) {
  if (!Array.isArray(events) || events.length > 500) throw new Error('Lote inválido (máximo 500 operaciones).');
  if (!db || typeof persist !== 'function' || typeof restore !== 'function' || typeof statePayloadHash !== 'function') {
    throw new Error('El receptor LAN no tiene configurada la persistencia durable.');
  }
  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.run(params); } finally { statement.free(); }
  };
  const one = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); return statement.step() ? statement.getAsObject() : null; }
    finally { statement.free(); }
  };

  const accepted = [];
  const duplicates = [];
  const conflicts = [];
  const allowedCollections = new Set([
    'sales','purchases','cxc','cxp','cortesZ','kardex','counts','held','heldDeletedIds','movimientosCaja','rateAudit','lotesSudeban',
    'casheaMovimientos','casheaLiquidaciones','cambiosDivisas',
    'retencionesIva','retentions','returns','voids'
  ]);
  const boxScopedCollections = new Set([
    'sales','purchases','cxc','cxp','cortesZ','counts','openings','movements','held','heldDeletedIds','movimientosCaja','rateAudit',
    'returns','voids','retencionesIva','retentions','casheaMovimientos',
    'casheaLiquidaciones','cambiosDivisas'
  ]);
  const databaseBefore = db.export();

  db.run('BEGIN IMMEDIATE');
  try {
    for (const event of events) {
      if (!event || !event.eventId || String(event.eventId).length > 256 || !event.deviceId || String(event.deviceId).length > 128 ||
          !Number.isSafeInteger(Number(event.deviceSeq)) || Number(event.deviceSeq) < 1 ||
          !event.eventType || String(event.eventType).length > 64 || !event.entityType || String(event.entityType).length > 64 ||
          !event.entityId || String(event.entityId).length > 256 || String(event.occurredAt || '').length > 100 ||
          !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
        throw new Error('Operación inválida.');
      }
      const eventId = String(event.eventId);
      const deviceId = String(event.deviceId);
      const deviceSeq = Number(event.deviceSeq);
      const eventType = String(event.eventType);
      const entityType = String(event.entityType);
      const entityId = String(event.entityId);
      const eventPayload = JSON.stringify(event.payload);
      const existing = one(
        'SELECT event_id AS eventId,device_id AS deviceId,device_seq AS deviceSeq,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,payload FROM network_received_operations WHERE event_id=?',
        [eventId]
      );
      const seqOwner = one(
        'SELECT event_id FROM network_received_operations WHERE device_id=? AND device_seq=?',
        [deviceId, deviceSeq]
      );
      if (existing) {
        const sameEvent = existing.deviceId === deviceId &&
          Number(existing.deviceSeq) === deviceSeq &&
          existing.eventType === eventType &&
          existing.entityType === entityType &&
          existing.entityId === entityId &&
          existing.payload === eventPayload;
        if (sameEvent) duplicates.push(eventId);
        else conflicts.push({ eventId, reason: 'event-id-reused-with-different-data', existingEventId: existing.eventId });
        continue;
      }
      if (seqOwner) {
        conflicts.push({ eventId, reason: 'device-sequence-already-used', existingEventId: seqOwner.event_id });
        continue;
      }

      const collection = entityType;
      const record = event.payload.record;
      if (!allowedCollections.has(collection) || !record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('La operación no contiene una entidad permitida y un registro válido.');
      }
      const eventIdCollections = new Set(['kardex','lotesSudeban','rateAudit','casheaLiquidaciones']);
      const recordId = String(eventIdCollections.has(collection) ? (record.eventId ?? record.id ?? record.uuid ?? record.no ?? record.number ?? record.ctrlNo ?? record.code ?? '') : (record.id ?? record.uuid ?? record.eventId ?? record.no ?? record.number ?? record.ctrlNo ?? record.code ?? ''));
      if (!recordId || recordId !== entityId) throw new Error('El identificador de entidad no coincide con el identificador del registro.');

      let state = null;
      let records = [];
      let existingRecord = null;
      const stateRow = one('SELECT payload FROM app_state WHERE id=1');
      state = stateRow ? JSON.parse(stateRow.payload) : {};
      records = Array.isArray(state[collection]) ? state[collection] : [];
      const recordIdentity = item => {
        const id = String(eventIdCollections.has(collection) ? (item.eventId ?? item.id ?? item.uuid ?? item.no ?? item.number ?? item.ctrlNo ?? item.code ?? '') : (item.id ?? item.uuid ?? item.eventId ?? item.no ?? item.number ?? item.ctrlNo ?? item.code ?? ''));
        return boxScopedCollections.has(collection) ? String(item.cashbox || 'sin-caja') + ':' + id : id;
      };
      const incomingIdentity = boxScopedCollections.has(collection)
        ? String(record.cashbox || 'sin-caja') + ':' + entityId
        : entityId;
      existingRecord = records.find(item => item && recordIdentity(item) === incomingIdentity);
      if (existingRecord && JSON.stringify(existingRecord) !== JSON.stringify(record)) {
        conflicts.push({ eventId, reason: 'entity-already-exists-with-different-data', entityType: collection, entityId });
        continue;
      }

      run(
        'INSERT INTO network_received_operations(event_id,device_id,device_seq,event_type,entity_type,entity_id,occurred_at,payload) VALUES(?,?,?,?,?,?,?,?)',
        [eventId, deviceId, deviceSeq, eventType, collection, entityId, String(event.occurredAt || new Date().toISOString()), eventPayload]
      );
      if (!existingRecord) {
        state[collection] = [...records, record];
        if (collection === 'heldDeletedIds') {
          const deletedId = String(record.id);
          const deletedBox = String(record.cashbox || 'sin-caja');
          state.held = (Array.isArray(state.held) ? state.held : []).filter(item =>
            !(String(item && item.id || '') === deletedId && String(item && item.cashbox || 'sin-caja') === deletedBox)
          );
        }
        run(
          'INSERT INTO app_state(id,payload,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP',
          [JSON.stringify(state)]
        );
      }
      accepted.push(eventId);
    }
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }

  try {
    persist();
  } catch (persistError) {
    restore(databaseBefore);
    throw new Error('No se confirmó la persistencia en disco; el servidor restauró el estado anterior y rechazó el lote. ' + (persistError.message || String(persistError)));
  }

  const stateRow = one('SELECT payload FROM app_state WHERE id=1');
  return {
    ok: true,
    accepted,
    duplicates,
    conflicts,
    stateHash: statePayloadHash(stateRow && stateRow.payload),
    note: 'Las operaciones aceptadas se aplicaron al estado central y se persistieron en SQLite.'
  };
}

module.exports = { applyIncomingEvents };
