const fs = require('node:fs');

function integrityStatus(database) {
  try {
    const result = database.exec('PRAGMA integrity_check');
    return result[0] && result[0].values[0] ? String(result[0].values[0][0]) : 'sin resultado';
  } catch (error) {
    return 'error: ' + (error && error.message ? error.message : String(error));
  }
}

function writeDurable(file, bytes, fsImpl = fs) {
  const temporary = file + '.recovery.tmp';
  let fd;
  try {
    fd = fsImpl.openSync(temporary, 'w', 0o600);
    fsImpl.writeFileSync(fd, bytes);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch {} }
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch {}
    throw new Error('No se pudo restaurar de forma durable el archivo SQLite desde el respaldo. ' + (error.message || String(error)));
  }
}

function openOrRecoverDatabase({ SQL, file, fsImpl = fs }) {
  if (!SQL || typeof SQL.Database !== 'function' || !file) throw new Error('Falta el motor SQLite o la ruta de base de datos.');
  const backup = file + '.bak';
  if (fsImpl.existsSync(file)) {
    let database = null;
    let openError = null;
    try { database = new SQL.Database(new Uint8Array(fsImpl.readFileSync(file))); }
    catch (error) { openError = error; }
    const integrity = database ? integrityStatus(database) : 'no se pudo abrir: ' + (openError && openError.message ? openError.message : 'error desconocido');
    if (database && integrity === 'ok') return { database, recovered: false, source: 'primary' };
    if (!fsImpl.existsSync(backup)) throw new Error('La base SQLite principal está dañada (' + integrity + ') y no existe respaldo automático. Se conserva el archivo original: ' + file);
    let restored;
    try { restored = new SQL.Database(new Uint8Array(fsImpl.readFileSync(backup))); }
    catch { throw new Error('SQLite principal y respaldo no se pueden abrir. Se conservan ambos archivos para recuperación manual.'); }
    const backupIntegrity = integrityStatus(restored);
    if (backupIntegrity !== 'ok') throw new Error('SQLite principal y respaldo fallaron integrity_check. No se sobrescribió ninguno de los dos archivos.');
    const corruptFile = file + '.corrupt-' + Date.now();
    fsImpl.renameSync(file, corruptFile);
    writeDurable(file, Buffer.from(fsImpl.readFileSync(backup)), fsImpl);
    return { database: restored, recovered: true, source: 'backup', corruptFile };
  }

  if (fsImpl.existsSync(backup)) {
    let restored;
    try { restored = new SQL.Database(new Uint8Array(fsImpl.readFileSync(backup))); }
    catch { throw new Error('No existe la base SQLite principal y el respaldo tampoco se puede abrir. Se conserva el respaldo para recuperación manual.'); }
    const backupIntegrity = integrityStatus(restored);
    if (backupIntegrity !== 'ok') throw new Error('No existe la base SQLite principal y el respaldo falló integrity_check. No se creará una base vacía.');
    writeDurable(file, Buffer.from(fsImpl.readFileSync(backup)), fsImpl);
    return { database: restored, recovered: true, source: 'backup', corruptFile: null };
  }

  return { database: new SQL.Database(), recovered: false, source: 'new', corruptFile: null };
}

module.exports = { integrityStatus, openOrRecoverDatabase };
