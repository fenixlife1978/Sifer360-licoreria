const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createDurableOutbox({ directory, deviceId, fsImpl = fs, pathImpl = path, cryptoImpl = crypto }) {
  if (!directory || !deviceId) throw new Error('El directorio y la identidad del dispositivo son obligatorios.');
  const file = pathImpl.join(directory, 'sifer360-network-outbox-v1.json');
  const temporary = file + '.tmp';

  function emptyState() {
    return { version: 1, deviceId: String(deviceId), lastSeq: 0, events: [] };
  }

  function readState() {
    if (!fsImpl.existsSync(file)) return emptyState();
    let state;
    try {
      state = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error('La cola LAN local está dañada. Se conserva el archivo para recuperación; no se descartaron operaciones. ' + (error.message || String(error)));
    }
    if (!state || state.version !== 1 || state.deviceId !== String(deviceId) ||
        !Number.isSafeInteger(state.lastSeq) || state.lastSeq < 0 || !Array.isArray(state.events)) {
      throw new Error('La cola LAN local no coincide con la identidad o versión de este equipo. Se conserva sin modificar.');
    }
    const eventIds = new Set();
    const deviceSequences = new Set();
    for (const event of state.events) {
      if (!event || typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 256 ||
          event.deviceId !== String(deviceId) || !Number.isSafeInteger(event.deviceSeq) ||
          event.deviceSeq < 1 || event.deviceSeq > state.lastSeq ||
          typeof event.eventType !== 'string' || !event.eventType ||
          typeof event.entityType !== 'string' || !event.entityType ||
          typeof event.entityId !== 'string' || !event.entityId || event.entityId.length > 256 ||
          !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload) ||
          !['pending', 'acked', 'conflict'].includes(event.status) ||
          eventIds.has(event.eventId) || deviceSequences.has(event.deviceSeq)) {
        throw new Error('La cola LAN contiene una operación inválida o duplicada. Se conserva sin modificar.');
      }
      eventIds.add(event.eventId);
      deviceSequences.add(event.deviceSeq);
    }
    return state;
  }

  function writeState(state) {
    let fd;
    try {
      fsImpl.mkdirSync(directory, { recursive: true });
      fd = fsImpl.openSync(temporary, 'w', 0o600);
      fsImpl.writeFileSync(fd, JSON.stringify(state), 'utf8');
      fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd);
      fd = undefined;
      fsImpl.renameSync(temporary, file);
    } catch (error) {
      if (fd !== undefined) {
        try { fsImpl.closeSync(fd); } catch {}
      }
      try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch {}
      throw new Error('No se pudo confirmar la cola LAN en disco; la operación no se enviará al servidor. ' + (error.message || String(error)));
    }
  }

  function enqueue(input) {
    if (!input || !input.eventType || !input.entityType || !input.entityId ||
        !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new Error('Operación LAN incompleta.');
    }
    const state = readState();
    const payloadText = JSON.stringify(input.payload);
    const existing = state.events.find(event =>
      (event.status === 'pending' || event.status === 'acked') &&
      event.serverDeviceId === String(input.serverDeviceId || '') &&
      event.eventType === String(input.eventType) &&
      event.entityType === String(input.entityType) &&
      event.entityId === String(input.entityId) &&
      JSON.stringify(event.payload) === payloadText
    );
    if (existing) return { ...existing, payload: JSON.parse(JSON.stringify(existing.payload)) };

    const event = {
      eventId: String(input.eventId || cryptoImpl.randomUUID()),
      deviceId: String(deviceId),
      serverDeviceId: String(input.serverDeviceId || ''),
      deviceSeq: state.lastSeq + 1,
      eventType: String(input.eventType),
      entityType: String(input.entityType),
      entityId: String(input.entityId),
      occurredAt: String(input.occurredAt || new Date().toISOString()),
      payload: JSON.parse(payloadText),
      status: 'pending'
    };
    if (!Number.isSafeInteger(event.deviceSeq)) throw new Error('Se agotó el consecutivo local de operaciones LAN.');
    if (state.events.some(item => item.eventId === event.eventId)) {
      const same = state.events.find(item => item.eventId === event.eventId);
      if (JSON.stringify({ ...same, status: undefined }) !== JSON.stringify({ ...event, status: undefined })) {
        throw new Error('El identificador de operación ya existe con datos diferentes.');
      }
      return { ...same };
    }
    state.lastSeq = event.deviceSeq;
    state.events.push(event);
    writeState(state);
    return { ...event };
  }

  function mark(ids, status, reason) {
    const selected = new Set((ids || []).map(String));
    if (!selected.size) return;
    const state = readState();
    let changed = false;
    for (const event of state.events) {
      if (selected.has(event.eventId) && event.status === 'pending') {
        event.status = status;
        if (reason) event.conflictReason = String(reason).slice(0, 300);
        changed = true;
      }
    }
    if (changed) {
      const completed = state.events.filter(event => event.status !== 'pending');
      const pending = state.events.filter(event => event.status === 'pending');
      state.events = [...completed.slice(-200), ...pending];
      writeState(state);
    }
  }

  return {
    enqueue,
    pending: () => readState().events.filter(event => event.status === 'pending').map(event => ({ ...event, payload: JSON.parse(JSON.stringify(event.payload)) })),
    acknowledge: ids => mark(ids, 'acked'),
    conflict: (ids, reason) => mark(ids, 'conflict', reason),
    conflicts: () => readState().events.filter(event => event.status === 'conflict').map(event => ({ ...event, payload: JSON.parse(JSON.stringify(event.payload)) })),
    get: eventId => {
      const event = readState().events.find(item => item.eventId === String(eventId));
      return event ? { ...event, payload: JSON.parse(JSON.stringify(event.payload)) } : null;
    },
    status: () => {
      const events = readState().events;
      return {
        pending: events.filter(event => event.status === 'pending').length,
        acknowledged: events.filter(event => event.status === 'acked').length,
        conflicts: events.filter(event => event.status === 'conflict').length
      };
    }
  };
}

module.exports = { createDurableOutbox };
