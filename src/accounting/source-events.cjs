const crypto = require("node:crypto");

const SOURCE_COLLECTIONS = Object.freeze({
  sales: "sale",
  purchases: "purchase",
  cxc: "receivable",
  cxp: "payable",
  cortesZ: "cash_close",
  kardex: "inventory_movement",
  counts: "inventory_count",
  returns: "return",
  voids: "void",
  casheaMovimientos: "cashea_operation",
  casheaLiquidaciones: "cashea_settlement",
  cambiosDivisas: "currency_movement",
  retencionesIva: "iva_retention",
  retentions: "retention"
});
const BOX_SCOPED = new Set(["sales", "cxc", "cortesZ", "returns", "voids"]);
const ID_FIELDS = ["id", "uuid", "eventId", "no", "number", "ctrlNo", "code"];

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stableIdentity(record, collection) {
  const raw = ID_FIELDS.map(key => record && record[key]).find(value => value !== undefined && value !== null && String(value).trim() !== "");
  const id = raw === undefined ? "anonymous-" + digest(JSON.stringify(record)).slice(0, 24) : String(raw);
  return BOX_SCOPED.has(collection) ? String(record.cashbox || "sin-caja") + ":" + id : id;
}
function eventDate(record, fallback) {
  if (record && record.ts !== undefined && record.ts !== null && record.ts !== "" && Number.isFinite(Number(record.ts))) {
    let value = Number(record.ts);
    if (value > 0 && value < 1e12) value *= 1000;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  for (const key of ["occurredAt", "createdAt", "updatedAt", "date", "fecha"]) {
    if (!record || !record[key]) continue;
    const parsed = new Date(record[key]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}
function asMap(items, collection) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    map.set(stableIdentity(item, collection), item);
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
    const before = asMap(previous[collection], collection);
    const after = asMap(next[collection], collection);
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
      const payloadHash = digest(payloadJson);
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
