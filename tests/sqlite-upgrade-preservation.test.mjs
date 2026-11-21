import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { openOrRecoverDatabase } = require("../electron/sqlite-recovery.cjs");

test("una instalación anterior sin SQLite ni respaldo se bloquea en vez de crear una base vacía", () => {
  let databaseCreated = false;
  const fsImpl = { existsSync: () => false };
  const SQL = { Database: class { constructor() { databaseCreated = true; } } };
  assert.throws(
    () => openOrRecoverDatabase({ SQL, file: "/userData/sifer360-licoreria.sqlite", fsImpl, allowCreate: false }),
    /instalación anterior.*no se creará una base vacía/i
  );
  assert.equal(databaseCreated, false);
});

test("una instalación verdaderamente nueva puede crear SQLite inicial", () => {
  let databaseCreated = false;
  const fsImpl = { existsSync: () => false };
  const SQL = { Database: class { constructor() { databaseCreated = true; } } };
  const result = openOrRecoverDatabase({ SQL, file: "/fresh/sifer360-licoreria.sqlite", fsImpl, allowCreate: true });
  assert.equal(databaseCreated, true);
  assert.equal(result.source, "new");
  assert.equal(result.recovered, false);
});
