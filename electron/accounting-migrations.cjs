const DEFAULT_MIGRATION_KEY = 'accounting-ven-nif-v1';

function integrityStatus(db) {
  const result = db.exec('PRAGMA integrity_check');
  return result[0] && result[0].values[0] ? String(result[0].values[0][0]) : 'sin resultado';
}

function assertNonDestructiveSchema(schemaSql) {
  const forbidden = [/\\bDROP\\s+TABLE\\b/i, /\\bDELETE\\s+FROM\\b/i, /\\bTRUNCATE\\b/i, /\\bVACUUM\\b/i, /\\bREPLACE\\s+INTO\\b/i];
  if (forbidden.some(pattern => pattern.test(schemaSql))) {
    throw new Error('La migración contable contiene una instrucción que puede eliminar o reemplazar datos existentes.');
  }
}

function hasMigration(db, migrationKey) {
  const stmt = db.prepare('SELECT 1 AS applied FROM schema_migrations WHERE migration_key = ? LIMIT 1');
  try { stmt.bind([migrationKey]); return stmt.step(); }
  finally { stmt.free(); }
}

function applyAccountingMigration({ db, schemaSql, migrationKey = DEFAULT_MIGRATION_KEY, persist = () => {}, restore = null }) {
  if (!db || typeof db.run !== 'function' || typeof schemaSql !== 'string' || !schemaSql.trim()) {
    throw new Error('Faltan la base SQLite o el esquema contable para ejecutar la migración.');
  }
  if (!migrationKey || typeof migrationKey !== 'string') throw new Error('La clave de migración contable no es válida.');
  assertNonDestructiveSchema(schemaSql);
  if (hasMigration(db, migrationKey)) return { applied: false, migrationKey };

  const snapshot = db.export();
  let transactionOpen = false;
  try {
    db.run('BEGIN IMMEDIATE');
    transactionOpen = true;
    db.run(schemaSql);
    db.run('INSERT INTO schema_migrations(migration_key, applied_at) VALUES(?, CURRENT_TIMESTAMP)', [migrationKey]);
    db.run('COMMIT');
    transactionOpen = false;
    const integrity = integrityStatus(db);
    if (integrity !== 'ok') throw new Error('La migración contable no superó PRAGMA integrity_check: ' + integrity);
    persist();
    return { applied: true, migrationKey };
  } catch (error) {
    if (transactionOpen) { try { db.run('ROLLBACK'); } catch {} }
    if (typeof restore === 'function') {
      try { restore(snapshot); }
      catch (restoreError) {
        throw new Error('Falló la migración contable y también la restauración de SQLite. Conserve la base y el respaldo para recuperación. Error original: ' +
          (error.message || String(error)) + '. Error de restauración: ' + (restoreError.message || String(restoreError)));
      }
    }
    throw error;
  }
}

module.exports = { DEFAULT_MIGRATION_KEY, integrityStatus, assertNonDestructiveSchema, applyAccountingMigration };
