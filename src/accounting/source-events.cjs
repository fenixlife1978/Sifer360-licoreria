const crypto = require("node:crypto");

const SOURCE_COLLECTIONS = Object.freeze({
  sales: "sale",
  purchases: "purchase",
  cxc: "receivable",
  cxp: "payable",
  cortesZ: "cash_close",
  openings: "cash_opening",
  movimientosCaja: "cash_movement",
  movements: "inventory_movement",
  held: "held_sale",
  kardex: "inventory_movement",
  counts: "inventory_count",
  returns: "return",
  voids: "void",
  casheaMovimientos: "cashea_operation",
  casheaLiquidaciones: "cashea_settlement",
  cambiosDivisas: "currency_movement",
  retencionesIva: "iva_retention",
  retencionesIslr: "islr_retention",
  fiscalBankOperations: "bank_operation",
  lotesSudeban: "bank_settlement_batch",
  rateAudit: "exchange_rate_update",
  fiscalInventoryMovements: "fiscal_inventory_movement",
  retentions: "retention"
});
const BOX_SCOPED = new Set(["sales", "cxc", "cortesZ", "openings", "movements", "movimientosCaja", "kardex", "returns", "voids"]);
const ID_FIELDS = ["eventId", "uuid", "id", "no", "number", "ctrlNo"];

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stableIdentity(record, collection) {
  const identityField = ID_FIELDS.find(key => record && record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== "");
  const raw = identityField ? record[identityField] : undefined;
  if (raw === undefined) {
    // Suspended sales in the current POS schema are identified by timestamp and cart snapshot.
    if (collection === "held" && record && record.ts !== undefined) {
      return "held:" + String(record.ts) + ":" + digest(JSON.stringify(record)).slice(0, 16);
    }
    // Cuando el registro no trae identificador, usa su contenido completo como identidad.
    // Un cambio se representará como baja + alta, pero nunca se perderán movimientos
    // distintos por compartir el mismo SKU/código de producto.
    return "snapshot:" + digest(JSON.stringify(record)).slice(0, 32);
  }
  const id = String(raw).trim();
  return BOX_SCOPED.has(collection) && identityField !== "eventId" && identityField !== "uuid"
    ? String(record.cashbox || "sin-caja") + ":" + id
    : id;
}
function localIsoWithOffset(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (number, size = 2) => String(number).padStart(size, "0");
  const offset = -parsed.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  return parsed.getFullYear() + "-" + pad(parsed.getMonth() + 1) + "-" + pad(parsed.getDate()) +
    "T" + pad(parsed.getHours()) + ":" + pad(parsed.getMinutes()) + ":" + pad(parsed.getSeconds()) +
    "." + pad(parsed.getMilliseconds(), 3) + sign + pad(Math.floor(absoluteOffset / 60)) + ":" + pad(absoluteOffset % 60);
}

function eventDate(record, fallback) {
  // El día del documento manda sobre la hora de captura: una compra registrada
  // hoy puede corresponder a una factura fechada ayer.
  for (const key of ["accountingDate", "docDate", "date", "fecha"]) {
    if (!record || record[key] === undefined || record[key] === null || record[key] === "") continue;
    const raw = String(record[key]).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsed = new Date(raw + "T00:00:00.000Z");
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) return raw + "T00:00:00.000Z";
    }
    const parsed = new Date(record[key]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (record && record.occurredAt) {
    const parsed = new Date(record.occurredAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  for (const key of ["ts", "timestamp"]) {
    if (!record || record[key] === undefined || record[key] === null || record[key] === "" || !Number.isFinite(Number(record[key]))) continue;
    let value = Number(record[key]);
    if (value > 0 && value < 1e12) value *= 1000;
    const local = localIsoWithOffset(value);
    if (local) return local;
  }
  for (const key of ["createdAt", "updatedAt"]) {
    if (!record || !record[key]) continue;
    const parsed = new Date(record[key]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}
function collectionItems(state, collection) {
  if (collection === "fiscalInventoryMovements") {
    return state.fiscalInventory && Array.isArray(state.fiscalInventory.movements)
      ? state.fiscalInventory.movements
      : [];
  }
  return state[collection];
}

function asMap(items, collection) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const identity = stableIdentity(item, collection);
    if (identity) map.set(identity, item);
  }
  return map;
}

/**
 * Builds immutable, deterministic accounting source events from committed POS snapshots.
 * It never creates journal entries or changes commercial balances.
 */
function buildAccountingSourceEvents(previousState, nextState, options = {}) {
  const previous = previousState && typeof previousState === "object" ? previousState : {};
  const next = nextState && typeof nextState === "object" ? nextState : {};
  const capturedAt = options.capturedAt || new Date().toISOString();
  const deviceId = String(options.deviceId || "local");
  const events = [];

  for (const [collection, sourceType] of Object.entries(SOURCE_COLLECTIONS)) {
    const before = asMap(collectionItems(previous, collection), collection);
    const after = asMap(collectionItems(next, collection), collection);
    const identities = new Set([...before.keys(), ...after.keys()]);
    for (const sourceId of identities) {
      const previousRecord = before.get(sourceId) || null;
      const record = after.get(sourceId) || null;
      const action = !previousRecord ? "created" : !record ? "deleted" : "updated";
      if (previousRecord && record && JSON.stringify(previousRecord) === JSON.stringify(record)) continue;

      const body = {
        sourceCollection: collection,
        action,
        record: record || previousRecord,
        previousRecord,
        deviceId,
        capturedAt
      };
      const payloadJson = JSON.stringify(body);
      // The idempotency fingerprint excludes transport metadata (device and capture time):
      // the same commercial fact replicated by another terminal remains one source event.
      const payloadHash = digest(JSON.stringify({ sourceCollection: collection, action, record: record || previousRecord, previousRecord }));
      const eventType = action + "." + payloadHash.slice(0, 20);
      const eventId = digest(sourceType + "|" + sourceId + "|" + eventType);
      events.push({
        eventId,
        sourceType,
        sourceId,
        eventType,
        occurredAt: eventDate(record || previousRecord, capturedAt),
        payloadHash,
        payloadJson
      });
    }
  }
  return events;
}

module.exports = { SOURCE_COLLECTIONS, buildAccountingSourceEvents };
