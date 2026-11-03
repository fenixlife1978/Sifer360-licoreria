import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildAccountingSourceEvents } = require("../src/accounting/source-events.cjs");

test("captura alta, modificación y eliminación como eventos deterministas", () => {
  const before = { sales: [{ id: "V-1", cashbox: "01", total: 100, ts: 1793700000000 }] };
  const created = buildAccountingSourceEvents({}, before, { deviceId: "pc-01", capturedAt: "2026-11-03T12:00:00.000Z" });
  assert.equal(created.length, 1);
  assert.equal(created[0].sourceType, "sale");
  assert.equal(JSON.parse(created[0].payloadJson).action, "created");
  assert.equal(created[0].eventId, buildAccountingSourceEvents({}, before, { deviceId: "pc-01", capturedAt: "2026-11-03T12:00:00.000Z" })[0].eventId);

  const changed = { sales: [{ id: "V-1", cashbox: "01", total: 125, ts: 1793700000000 }] };
  const updated = buildAccountingSourceEvents(before, changed, { deviceId: "pc-01", capturedAt: "2026-11-03T12:01:00.000Z" });
  assert.equal(updated.length, 1);
  assert.equal(JSON.parse(updated[0].payloadJson).action, "updated");
  assert.notEqual(updated[0].eventId, created[0].eventId);

  const deleted = buildAccountingSourceEvents(changed, {}, { deviceId: "pc-01", capturedAt: "2026-11-03T12:02:00.000Z" });
  assert.equal(deleted.length, 1);
  assert.equal(JSON.parse(deleted[0].payloadJson).action, "deleted");
});

test("no mezcla ventas de cajas distintas y captura las familias financieras e inventario", () => {
  const before = { sales: [{ id: "V-1", cashbox: "01", total: 100 }] };
  const next = {
    sales: [{ id: "V-1", cashbox: "01", total: 100 }, { id: "V-1", cashbox: "02", total: 200 }],
    purchases: [{ id: "C-1", total: 50 }],
    kardex: [{ id: "K-1", quantity: 2 }],
    retencionesIva: [{ id: "R-1", amount: 5 }]
  };
  const events = buildAccountingSourceEvents(before, next, { deviceId: "pc-02" });
  assert.equal(events.length, 4);
  assert.deepEqual(new Set(events.map(event => event.sourceType)), new Set(["sale", "purchase", "inventory_movement", "iva_retention"]));
  assert.ok(events.some(event => event.sourceId === "02:V-1"));
});

test("no crea eventos por cambios ajenos a operaciones ni por snapshots idénticos", () => {
  const state = { sales: [{ id: "V-1", cashbox: "01", total: 100 }], cfg: { theme: "dark" } };
  assert.equal(buildAccountingSourceEvents(state, { ...state, cfg: { theme: "light" } }).length, 0);
  assert.equal(buildAccountingSourceEvents(state, JSON.parse(JSON.stringify(state))).length, 0);
});

test("la misma operación replicada desde otro terminal conserva el mismo evento", () => {
  const state = { sales: [{ id: "V-99", cashbox: "01", total: 88, ts: 1793700000000 }] };
  const first = buildAccountingSourceEvents({}, state, { deviceId: "terminal-01", capturedAt: "2026-11-03T12:00:00.000Z" });
  const replica = buildAccountingSourceEvents({}, state, { deviceId: "terminal-02", capturedAt: "2026-11-03T12:05:00.000Z" });
  assert.equal(first[0].eventId, replica[0].eventId);
  assert.equal(first[0].payloadHash, replica[0].payloadHash);
});
