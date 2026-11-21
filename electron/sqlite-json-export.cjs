'use strict';

function sqliteDatabaseToJson(database, generatedAt = new Date().toISOString()) {
  if (!database || typeof database.exec !== 'function') throw new Error('No se recibió una base SQLite válida.');
  const integrity = database.exec('PRAGMA integrity_check');
  if (!integrity[0] || !integrity[0].values[0] || String(integrity[0].values[0][0]) !== 'ok') {
    throw new Error('La base SQLite no superó integrity_check; no se generó el JSON.');
  }
  const namesResult = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const names = namesResult[0] ? namesResult[0].values.map(row => String(row[0])) : [];
  const schemaResult = database.exec("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','view','trigger') ORDER BY type,name");
  const schema = schemaResult[0] ? schemaResult[0].values.map(row => ({ type:String(row[0]), name:String(row[1]), table:String(row[2]), sql:row[3] === null ? null : String(row[3]) })) : [];
  const tables = {};
  for (const name of names) {
    const escaped = name.replace(/"/g, '""');
    const result = database.exec('SELECT * FROM "' + escaped + '"');
    if (!result[0]) { tables[name] = { columns: [], rows: [] }; continue; }
    tables[name] = {
      columns: result[0].columns,
      rows: result[0].values.map(row => row.map(value => {
        if (value instanceof Uint8Array || Buffer.isBuffer(value)) return { type: 'base64', value: Buffer.from(value).toString('base64') };
        return value;
      }))
    };
  }
  return Buffer.from(JSON.stringify({
    format: 'SIFER360_SQLITE_JSON_BACKUP_V1',
    generatedAt,
    databaseIntegrity: 'ok',
    schema,
    tables
  }, null, 2), 'utf8');
}

module.exports = { sqliteDatabaseToJson };
