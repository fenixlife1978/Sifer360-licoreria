import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const electron = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const eventStore = readFileSync(new URL('../electron/lan-event-store.cjs', import.meta.url), 'utf8');
const stateMerge = readFileSync(new URL('../electron/lan-state-merge.cjs', import.meta.url), 'utf8');
const sqliteRecovery = readFileSync(new URL('../electron/sqlite-recovery.cjs', import.meta.url), 'utf8');
const cashboxSequenceMigration = readFileSync(new URL('../electron/cashbox-sequence-migration.cjs', import.meta.url), 'utf8');
const lanAddress = readFileSync(new URL('../electron/lan-address.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

test('el ejecutable implementa un servidor LAN con puerto configurable', () => {
  assert.match(electron, /https\.createServer/);
  assert.match(electron, /network:configure-server/);
  assert.match(electron, /listen\(port, '0\.0\.0\.0'/);
  assert.match(electron, /network:stop-server/);
});

test('las rutas de sincronización requieren clave de emparejamiento', () => {
  assert.match(electron, /hasValidBearerToken\(req\.headers\.authorization, networkConfig\.token\)/);
  assert.match(electron, /require\('\.\/lan-auth\.cjs'\)/);
  assert.match(electron, /crypto\.randomBytes\(24\)\.toString\('hex'\)/);
  assert.match(electron, /network:configure-client/);
});

test('el servidor deduplica snapshots por dispositivo y hash', () => {
  assert.match(electron, /CREATE TABLE IF NOT EXISTS network_sync_events/);
  assert.match(electron, /INSERT OR IGNORE INTO network_sync_events/);
  assert.match(electron, /createHash\('sha256'\)/);
});

test('Electron expone solo métodos IPC específicos para la red', () => {
  assert.match(preload, /networkStartServer: options => ipcRenderer\.invoke\('network:configure-server'/);
  assert.match(preload, /networkConfigureClient: options => ipcRenderer\.invoke\('network:configure-client'/);
  assert.match(preload, /networkSyncNow: state => ipcRenderer\.invoke\('network:sync-now'/);
  assert.doesNotMatch(preload, /ipcRenderer\.on\(['"][^'"]+['"],\s*\(event/);
});

test('la aplicación reintenta sincronización automáticamente en segundo plano', () => {
  assert.match(pos, /setInterval\(\(\)=>\{if\(window\.posDesktop&&typeof window\.posDesktop\.networkSyncNow==='function'\)networkSyncAttempt\(\)\},20000\)/);
  assert.match(pos, /scheduleNetworkSync\(\)/);
  assert.match(pos, /Sin confirmación del servidor · las operaciones nuevas permanecen en la cola LAN local/);
  assert.match(pos, /saveQueue\.then\(async\(\)=>\{\s*await previousCapture;\s*await captureNewOperations\(state\);\s*return posSqliteDriver\.saveState\(state\);\s*\}\)/);
});

test('el administrador tiene panel para servidor y clientes LAN', () => {
  assert.match(ui, /Red y sincronización/);
  assert.match(ui, /Activar esta caja como servidor/);
  assert.match(ui, /Conectar esta caja como cliente/);
  assert.match(ui, /IP DETECTADA/);
});

test('el panel explica límites de red y recomienda reserva de IP', () => {
  assert.match(ui, /tráfico LAN usa HTTPS con certificado fijado por huella SHA-256/);
  assert.match(ui, /Compara manualmente la huella/);
  assert.match(ui, /No publiques el puerto en Internet/);
});

test('el servidor anuncia descubrimiento LAN sin exigir IP fija', () => {
  assert.ok(electron.includes("const dgram = require('dgram')"));
  assert.ok(electron.includes('SIFER360_DISCOVER_V1'));
  assert.ok(electron.includes('SIFER360_SERVER_V1'));
  assert.ok(electron.includes('DISCOVERY_PORT = 38761'));
  assert.ok(electron.includes('function discoverLanServers'));
});

test('la interfaz permite encontrar automáticamente la IP actual del servidor', () => {
  assert.ok(preload.includes('networkDiscover'));
  assert.ok(ui.includes('Buscar servidor automáticamente'));
  assert.ok(ui.includes('networkDiscover()'));
  assert.ok(ui.includes('No necesitas configurar una IP fija'));
});

test('la cola de operaciones tiene UUID, secuencia por dispositivo y estado de acuse', () => {
  assert.match(electron, /CREATE TABLE IF NOT EXISTS local_operation_outbox/);
  assert.match(electron, /UNIQUE\(device_id, device_seq\)/);
  assert.match(electron, /crypto\.randomUUID\(\)/);
  assert.match(electron, /network:operation-create/);
  assert.match(electron, /network:operation-pending/);
  assert.match(electron, /status='acked'/);
});

test('el servidor recibe operaciones idempotentes y detecta colisiones de secuencia', () => {
  assert.match(electron, /\/api\/sync\/events/);
  assert.match(electron, /CREATE TABLE IF NOT EXISTS network_received_operations/);
  assert.match(eventStore, /device-sequence-already-used/);
  assert.match(electron, /result\.duplicates/);
  assert.match(preload, /networkCreateOperation/);
  assert.match(preload, /networkOperationStatus/);
});

test('el POS convierte nuevos registros operativos en eventos de la cola local', () => {
  assert.match(pos, /OPERATION_COLLECTIONS/);
  assert.match(pos, /\['sales','sale'\]/);
  assert.match(pos, /\['purchases','purchase'\]/);
  assert.match(pos, /await captureNewOperations\(state\)/);
  assert.match(pos, /networkCreateOperation\(/);
  assert.match(pos, /primeOperationBaseline\(\)/);
});

test('el servidor aplica una operación nueva una sola vez y reporta entidades en conflicto', () => {
  assert.match(eventStore, /allowedCollections/);
  assert.match(eventStore, /existingRecord/);
  assert.match(eventStore, /entity-already-exists-with-different-data/);
  assert.match(electron, /network_received_operations/);
  assert.match(eventStore, /conflicts\.push/);
});

test('el servidor separa identificadores iguales cuando pertenecen a cajas distintas', () => {
  assert.match(eventStore, /const boxScopedCollections = new Set\(/);
  assert.match(eventStore, /String\(record\.cashbox \|\| 'sin-caja'\) \+ ':' \+ entityId/);
  assert.match(eventStore, /recordIdentity\(item\) === incomingIdentity/);
});

test('CASHEA no precarga operaciones ficticias y elimina únicamente firmas semilla conocidas', () => {
  assert.match(pos, /S\.casheaMovimientos=\[\];/);
  assert.match(pos, /demoCasheaSignatures/);
  assert.match(pos, /Number\(m\.financiadoUsd\)===demo\.financiadoUsd/);
});

test('la liquidación CASHEA exige depósito real conciliado y guarda trazabilidad del lote', () => {
  assert.match(pos, /Monto neto depositado según banco/);
  assert.match(pos, /Liquidación rechazada/);
  assert.match(pos, /S\.casheaLiquidaciones\.push/);
  assert.match(pos, /depositadoUsd:depositUsd/);
  assert.match(pos, /includeBatch\?batch\.depositadoUsd/);
  assert.match(pos, /Referencia_Bancaria/);
});


test('el cobro solo exige aprobación real para CASHEA', () => {
  assert.ok(pos.includes("const refPrompts={cashea:"));
  assert.ok(!pos.includes("const refPrompts={zelle:"));
  assert.ok(pos.includes("Aprobación CASHEA"));
  assert.ok(pos.includes("finalize(last,enteredAmts,isCred,cDays,enteredRefs,el)"));
});

test('el asistente Cashea vuelve al modal de pago y conserva el plan aplicado', () => {
  assert.match(pos, /function payDlg\(draft\)/);
  assert.match(pos, /Volver al pago/);
  assert.match(pos, /payDlg\(draftNow\)/);
  assert.match(pos, /Confirme el cobro para finalizar la factura/);
  assert.match(pos, /Array\.from\(\{length:cuotasCount\}/);
});

test('Cashea no inventa una aprobación ni afirma conexión oficial inexistente', () => {
  assert.doesNotMatch(pos, /placeholder="CSH-894120" value="CSH-/);
  assert.doesNotMatch(pos, /const cRef=\(refs&&refs\.cashea\)\|\|\('CSH-'\+/);
  assert.match(pos, /código real de aprobación Cashea/);
  assert.match(pos, /no consulta ni confirma aprobaciones mediante la API oficial de Cashea/);
});

test('las liquidaciones CASHEA se encolan y se aceptan al sincronizar cajas', () => {
  assert.match(pos, /\['casheaLiquidaciones','cashea-settlement'\]/);
  assert.match(eventStore, /'casheaLiquidaciones'/);
  assert.match(eventStore, /allowedCollections\.has\(collection\)/);
});

test('cobros expone efectivo, Zelle, pago móvil, transferencia, tarjeta, Biopago y Cashea', () => {
  for (const method of ['efUSD','efBs','zelle','pmovil','transf','punto','biopago','cashea']) {
    assert.match(pos, new RegExp("id:'" + method + "'"));
  }
  assert.match(pos, /id="pm-'\+m\.id\+'" data-m="'\+m\.id\+'/);
  assert.match(pos, /const pays=METHODS\.filter\(m=>amts\[m\.id\]>0\)/);
  assert.match(pos, /Enviar saldo pendiente a/);
  assert.match(pos, /S\.cxc\.push/);
});

test('CASHEA permite seleccionar liquidaciones parciales y concilia solo el lote seleccionado', () => {
  assert.match(pos, /const allPendings = \(S\.casheaMovimientos \|\| \[\]\)\.filter/);
  assert.match(pos, /data-liq-op=/);
  assert.match(pos, /pendings = allPendings\.filter/);
  assert.match(pos, /totFinanciado = r2\(pendings\.reduce/);
  assert.match(pos, /Math\.abs\(depositUsd-netoUsd\)>0\.01/);
  assert.match(pos, /m\.estado = 'Liquidado'/);
});

test('CASHEA registra reversión auditada, exige autorización y devuelve operaciones a pendientes', () => {
  assert.match(pos, /function reverseCasheaSettlement\(/);
  assert.match(pos, /requestPin\('Revertir liquidación CASHEA '\+lot\.id\)/);
  assert.match(pos, /No se puede revertir: el servicio de autorización no está disponible/);
  assert.match(pos, /lot\.estado='Revertido'/);
  assert.match(pos, /tipo:'REVERSIÓN'/);
  assert.match(pos, /m\.estado='Pendiente Liquidación'/);
  assert.match(pos, /data-csh-reverse=/);
});

test('la liquidación CASHEA guarda referencia bancaria y el depósito real conciliado', () => {
  assert.match(pos, /refBancaria = ref/);
  assert.match(pos, /depositadoUsd:depositUsd/);
  assert.match(pos, /diferenciaUsd:r2\(depositUsd-netoUsd\)/);
});

test('SQLite valida integridad antes de guardar y mantiene respaldo recuperable', () => {
  assert.match(electron, /function databaseIntegrityStatus\(/);
  assert.match(electron, /PRAGMA integrity_check/);
  assert.match(electron, /Se impidió guardar SQLite/);
  assert.match(electron, /const backup = target \+ '\.bak'/);
  assert.match(electron, /fs\.copyFileSync\(target, backupTemporary\)/);
  assert.match(sqliteRecovery, /const backup = file \+ '\.bak'/);
  assert.match(sqliteRecovery, /file \+ '\.corrupt-'/);
  assert.match(sqliteRecovery, /integrity_check/);
});


test('los guardados SQLite locales revierten el cambio en memoria si falla la persistencia durable', () => {
  assert.match(electron, /function persistMutation\(mutate\)/);
  assert.match(electron, /const snapshot = db\.export\(\)/);
  assert.match(electron, /restoreDatabaseSnapshot\(snapshot\)/);
  assert.match(electron, /persistMutation\(\(\) => run\('INSERT INTO app_state/);
  assert.match(electron, /persistMutation\(\(\) => run\('INSERT OR REPLACE INTO fiscal_documents/);
  assert.match(electron, /persistMutation\(\(\) => run\('DELETE FROM fiscal_documents/);
});

test('la sincronización iniciada por el servidor también revierte su snapshot si falla la escritura', () => {
  assert.match(electron, /let merged;\s*\n\s*persistMutation\(\(\) => \{/);
  assert.match(electron, /merged = mergeStateRecords\(row \? JSON\.parse\(row\.payload\) : null, state\)/);
});


test('el servidor no confirma eventos desconocidos o sin un registro aplicable', () => {
  assert.match(eventStore, /!allowedCollections\.has\(collection\) \|\| !record/);
  assert.match(eventStore, /La operación no contiene una entidad permitida y un registro válido/);
});

test('reutilizar un eventId con contenido distinto se marca como conflicto y no como duplicado', () => {
  assert.match(eventStore, /event-id-reused-with-different-data/);
  assert.match(eventStore, /existing\.payload === eventPayload/);
  assert.match(eventStore, /if \(sameEvent\) duplicates\.push/);
});


test('un cliente no transmite claves ni datos a hosts fuera de la red local', () => {
  assert.match(lanAddress, /function assertLanHost\(host\)/);
  assert.match(lanAddress, /if \(!isLanAddress\(host\)\) throw new Error/);
  assert.match(electron, /assertLanHost\(networkConfig\.host\)/);
  assert.match(electron, /assertLanHost\(host\)/);
});

test('Electron usa la cola durable del cliente y reintenta eventos pendientes antes del snapshot', () => {
  assert.match(electron, /createDurableOutbox\(\{ directory: app\.getPath\('userData'\), deviceId: networkConfig\.deviceId \}\)/);
  assert.match(electron, /const event = clientOutbox\.enqueue\(/);
  assert.match(electron, /async function flushClientOutbox\(\)/);
  assert.match(electron, /await flushClientOutbox\(\)/);
  assert.match(electron, /clientOutbox\.acknowledge\(accepted\)/);
  assert.match(electron, /clientOutbox\.conflict\(/);
  assert.match(electron, /clientOutbox\.pending\(\)/);
  assert.match(electron, /clientOutbox\.status\(\)/);
});

test('el cliente captura el registro nuevo antes de esperar la red y conserva la operación si falla el guardado remoto', () => {
  const capture = pos.slice(pos.indexOf('async function captureNewOperations'), pos.indexOf('function mergeRemoteSnapshot'));
  assert.ok(capture.indexOf('const snap=stateSnapshot()') < capture.indexOf('await window.posDesktop.networkStatus()'));
  assert.match(capture, /delivery\.serverConfirmed!==true\|\|delivery\.status!=='acked'/);
  assert.match(capture, /await window\.posDesktop\.networkCreateOperation\(/);
  assert.doesNotMatch(capture, /await lastSave/);
});

test('un evento pendiente en disco no detiene la captura de las siguientes operaciones del cliente', () => {
  assert.match(electron, /durable: 'client-outbox'/);
  assert.match(electron, /serverConfirmed: !!delivery && delivery\.status === 'acked'/);
  assert.doesNotMatch(electron, /throw new Error\('La operación quedó guardada en la cola local durable/);
});

test('todo el transporte de operaciones LAN usa HTTPS con certificado y huella fijados', () => {
  assert.match(electron, /ensureServerCertificate/);
  assert.match(electron, /https\.createServer\(\{ key: identity\.key, cert: identity\.cert \}/);
  assert.match(electron, /createPinnedAgent\(networkConfig\.serverCert, networkConfig\.tlsFingerprint\)/);
  assert.match(electron, /retrievePeerCertificate\(host, port, 5000\)/);
  assert.match(electron, /verifyFingerprint\(peer\.fingerprint, expectedFingerprint\)/);
  assert.match(electron, /safeStorage\.encryptString/);
  assert.match(electron, /safeStorage\.decryptString/);
  assert.match(electron, /tokenEncrypted/);
  assert.doesNotMatch(electron, /fetch\('http:\/\//);
  assert.doesNotMatch(ui, /http:\/\/'\+ip/);
  assert.match(pos, /lanFingerprintInput/);
  assert.match(pos, /Huella TLS SHA-256/);
});

test('el descubrimiento anuncia la huella TLS, pero la conexión exige compararla manualmente', () => {
  assert.match(electron, /tlsFingerprint: networkConfig\.tlsFingerprint/);
  assert.match(electron, /tlsFingerprint: data\.tlsFingerprint/);
  assert.match(electron, /No se enviaron credenciales/);
  assert.match(pos, /cópiala desde la pantalla del servidor/);
  assert.match(pos, /Compara la huella de esta pantalla con la mostrada físicamente en el servidor/);
});

test('una PC cliente no puede convertirse en servidor usando silenciosamente una SQLite local antigua', () => {
  assert.match(electron, /networkConfig\.role === 'client' \|\| networkConfig\.serverPromotionBlocked/);
  assert.match(electron, /serverPromotionBlocked: true/);
  assert.match(electron, /No puede convertirse en servidor automáticamente/);
});

test('un conflicto de evento bloquea el envío del snapshot completo para no sobreescribir la entidad', () => {
  assert.match(electron, /if \(conflicts\.length\) throw new Error\('El servidor detectó conflictos en operaciones LAN/);
  assert.match(electron, /await flushClientOutbox\(\);\s*const result = await clientApi\('\/api\/sync\/state'/);
});

test('la fusión de snapshots conserva cajas separadas para CASHEA y cambios de divisas', () => {
  assert.match(stateMerge, /'casheaLiquidaciones','cambiosDivisas'/);
  assert.match(stateMerge, /timestampValue = value =>/);
  assert.match(stateMerge, /timestampValue\(item\.updatedAt \|\| item\.ts \|\| item\.createdAt\)/);
  assert.match(pos, /'casheaLiquidaciones','cambiosDivisas'/);
  assert.match(pos, /Operación guardada en la cola LAN local/);
  assert.match(pos, /Conflicto LAN en/);
});

test('los conflictos LAN anteriores mantienen bloqueado el snapshot hasta su conciliación', () => {
  assert.match(electron, /const currentStatus = clientOutbox\.status\(\)/);
  assert.match(electron, /currentStatus\.conflicts > 0/);
  assert.match(electron, /snapshot completo hasta conciliar/);
});

test('el endpoint LAN delega la aplicación transaccional a un módulo probado con SQLite real', () => {
  assert.match(electron, /require\('\.\/lan-event-store\.cjs'\)/);
  assert.match(electron, /applyIncomingEvents\(\{[\s\S]*?persist: \(\) => persistDb\(\)/);
  assert.match(electron, /restore: snapshot => restoreDatabaseSnapshot\(snapshot\)/);
});

test('la pantalla alternativa de acceso tampoco muestra instrucciones LAN inseguras', () => {
  assert.doesNotMatch(ui, /no cifra el tráfico/);
  assert.match(ui, /HUELLA TLS SHA-256/);
  assert.match(ui, /Compara manualmente la huella/);
  assert.match(ui, /https:\/\//);
  assert.match(ui, /fingerprint:\$\('#sa-net-fingerprint'\)\.value/);
});

test('los conflictos HTTP 409 se identifican explícitamente como concurrencia', () => {
  assert.match(electron, /response\.statusCode === 409 \? 'Conflicto de concurrencia: '/);
  assert.match(pos, /includes\('conflicto'\)/);
});

test('las claves de emparejamiento se almacenan cifradas con el almacén seguro del sistema operativo', () => {
  assert.match(electron, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(electron, /safeStorage\.encryptString\(stored\.token\)/);
  assert.match(electron, /safeStorage\.decryptString\(Buffer\.from\(stored\.tokenEncrypted, 'base64'\)\)/);
  assert.match(electron, /no se guardará la clave LAN en texto claro/);
});

test('los conflictos LAN se pueden inspeccionar desde ambas pantallas de administración', () => {
  assert.match(electron, /network:operation-conflicts/);
  assert.match(preload, /networkOperationConflicts/);
  assert.match(ui, /networkOperationConflicts\(\)/);
  assert.match(pos, /networkOperationConflicts\(\)/);
  assert.match(ui, /Sincronización bloqueada/);
});

test('desconectar una PC cliente no la convierte en independiente ni abre una SQLite local obsoleta', () => {
  const disconnect = electron.slice(electron.indexOf("ipcMain.handle('network:disconnect-client'"), electron.indexOf("ipcMain.handle('network:configure-client'"));
  assert.match(disconnect, /role: 'client'/);
  assert.match(disconnect, /serverPromotionBlocked: true/);
  assert.doesNotMatch(disconnect, /role: 'standalone'/);
  assert.doesNotMatch(disconnect, /initializeDatabase\(\)/);
  assert.match(electron, /Cliente LAN desconectado\. No se usará SQLite local como autoridad/);
  assert.match(pos, /seguirá sin base operativa local/);
});

test('las operaciones pendientes quedan vinculadas a la identidad del servidor y no migran a otra base', () => {
  assert.match(electron, /serverDeviceId: networkConfig\.serverDeviceId/);
  assert.match(electron, /foreignServerEvents/);
  assert.match(electron, /server-identity-changed/);
  assert.match(electron, /No se enviarán a otra base de datos/);
  assert.match(electron, /pendingForAnotherServer/);
});

test('SQLite y su respaldo se vacían a disco antes del reemplazo atómico', () => {
  assert.match(electron, /function writeDurableFile\(file, data\)/);
  assert.match(electron, /fs\.fsyncSync\(fd\)/);
  assert.match(electron, /writeDurableFile\(temporary, Buffer\.from\(bytes\)\)/);
  assert.match(electron, /fs\.fsyncSync\(backupFd\)/);
  assert.match(electron, /fs\.renameSync\(temporary, target\)/);
});

test('la inicialización recupera una copia SQLite si falta o está dañada la principal', () => {
  assert.match(electron, /require\('\.\/sqlite-recovery\.cjs'\)/);
  assert.match(electron, /openOrRecoverDatabase\(\{ SQL, file \}\)/);
});

test('una base recuperada persiste también el esquema actualizado antes de aceptar operaciones', () => {
  assert.match(electron, /if \(opened\.recovered && !sequenceMigrationApplied\) persistDb\(\)/);
});

test('un fallo al persistir la cola de auditoría LAN se comunica y no se oculta en consola', () => {
  assert.match(pos, /No se pudo confirmar una operación en el servidor LAN/);
  assert.match(pos, /Operación no confirmada por el servidor LAN/);
});

test('el cliente impide enviar snapshots mayores que el límite del servidor', () => {
  assert.match(electron, /Buffer\.byteLength\(options\.body, 'utf8'\) > MAX_SYNC_BODY/);
  assert.match(electron, /La operación supera el límite de tamaño permitido para sincronización LAN/);
});

test('el estado de cliente desconectado se comunica sin presentarlo como modo independiente', () => {
  assert.match(pos, /Cliente LAN desconectado · no se confirman operaciones ni se usa SQLite local/);
});

test('solo un proceso Electron puede abrir la base SQLite operativa en cada instalación', () => {
  assert.match(electron, /app\.requestSingleInstanceLock\(\)/);
  assert.match(electron, /app\.on\('second-instance'/);
  assert.match(electron, /if \(!hasSingleInstanceLock\) \{\s*app\.quit\(\)/);
});

test('la validación de direcciones LAN estricta está aislada y se usa antes de enviar credenciales', () => {
  assert.match(electron, /require\('\.\/lan-address\.cjs'\)/);
  assert.match(electron, /assertLanHost\(networkConfig\.host\)/);
  assert.match(electron, /assertLanHost\(host\)/);
  assert.match(lanAddress, /net\.isIP\(host\)/);
});

test('al cambiar o volver a emparejar servidor se invalida el hash anterior hasta leer la base central', () => {
  assert.match(electron, /serverCert: peer\.certificate, tlsFingerprint: peer\.fingerprint, serverStateHash: ''/);
});

test('el servidor limita cuerpos LAN por bytes y no por caracteres Unicode', () => {
  assert.match(electron, /let receivedBytes = 0/);
  assert.match(electron, /receivedBytes \+= Buffer\.isBuffer\(chunk\) \? chunk\.length : Buffer\.byteLength/);
  assert.match(electron, /if \(receivedBytes > MAX_SYNC_BODY\)/);
  assert.match(electron, /if \(rejected\) return/);
});

test('el cliente limita las respuestas LAN por bytes UTF-8', () => {
  assert.match(electron, /let receivedBytes = 0;\s*response\.setEncoding\('utf8'\)/);
  assert.match(electron, /receivedBytes \+= Buffer\.byteLength\(chunk, 'utf8'\)/);
});

test('el cliente distingue conflicto de hash, conflicto de eventos y desconexión', () => {
  assert.match(pos, /base central cambió/);
  assert.match(pos, /Recargue SIFER para traer la base central/);
  assert.match(pos, /conflictos LAN/);
  assert.match(pos, /Cliente LAN desconectado/);
});

test('el servidor y los clientes rechazan puertos LAN inválidos en lugar de usar NaN', () => {
  assert.match(electron, /function normalizeLanPort\(value\)/);
  assert.match(electron, /Number\.isInteger\(port\) \|\| port < 1024 \|\| port > 65535/);
  assert.match(electron, /const port = normalizeLanPort\(requestedPort/);
  assert.match(electron, /const port = normalizeLanPort\(opts\.port/);
});

test('el endpoint de consecutivos utiliza el asignador SQLite transaccional probado', () => {
  assert.match(electron, /require\('\.\/cashbox-sequence\.cjs'\)/);
  assert.match(electron, /allocateCashboxSequenceDurable\(\{ db, cashboxId, operationType/);
});

test('el arranque migra una sola vez los consecutivos históricos compartidos', () => {
  assert.match(electron, /require\('\.\/cashbox-sequence-migration\.cjs'\)/);
  assert.match(electron, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(electron, /migrateCashboxSequenceCategories\(\{ db, state:/);
  assert.match(cashboxSequenceMigration, /cashbox-operation-sequences-v1/);
});

test('las escrituras del renderer se serializan y un fallo recarga el estado autoritativo o bloquea nuevas escrituras', () => {
  assert.match(pos, /let saveQueue=Promise\.resolve\(\),saveSequence=0,persistenceBlocked=false/);
  assert.match(pos, /await captureNewOperations\(state\);\s*return posSqliteDriver\.saveState\(state\)/);
  assert.match(pos, /const authoritative=await posSqliteDriver\.loadState\(\)/);
  assert.match(pos, /OPERACIÓN NO CONFIRMADA: se recargó el último estado durable/);
  assert.match(pos, /persistenceBlocked=true/);
});

test('una operación pendiente sin identidad de servidor también bloquea el emparejamiento a otra base', () => {
  assert.match(electron, /clientOutbox\.pending\(\)\.some\(event => !event\.serverDeviceId \|\| event\.serverDeviceId !== health\.deviceId\)/);
  assert.match(electron, /No se cambiará de base central hasta conciliarlos/);
});

test('la sincronización también bloquea operaciones antiguas sin identidad de servidor', () => {
  assert.match(electron, /const foreignServerEvents = pending\.filter\(event => !event\.serverDeviceId \|\| event\.serverDeviceId !== networkConfig\.serverDeviceId\)/);
  assert.match(electron, /server-identity-changed/);
});

test('el renderer captura y confirma operaciones nuevas antes del snapshot completo', () => {
  assert.match(pos, /await captureNewOperations\(state\)/);
  assert.doesNotMatch(pos, /const lastSave=window\.__SIFER_LAST_SAVE;\s*if\(lastSave\)\{const persisted=await lastSave/);
  assert.match(pos, /window\.posDesktop\.networkCreateOperation\(/);
});

test('la reconexión recupera el estado del servidor y desbloquea escrituras previamente bloqueadas', () => {
  assert.match(pos, /if\(persistenceBlocked\|\|saveSequence===syncRevision\)\{\s*for\(const key of Object\.keys\(S\)\)delete S\[key\];\s*Object\.assign\(S,result\.state\);\s*primeOperationBaseline\(\);\s*persistenceBlocked=false/);
});

test('desconectar conserva la identidad del servidor anterior para etiquetar nuevas operaciones pendientes', () => {
  const handler = electron.slice(electron.indexOf("ipcMain.handle('network:disconnect-client'"), electron.indexOf("ipcMain.handle('network:configure-client'"));
  assert.match(handler, /role: 'client'/);
  assert.doesNotMatch(handler, /serverDeviceId: ''/);
  assert.match(handler, /serverPromotionBlocked: true/);
});

test('la sincronización LAN preserva y captura movimientos de caja, auditoría de tasa y lotes bancarios', () => {
  assert.match(pos, /\['movimientosCaja','cashbox-movement'\]/);
  assert.match(pos, /\['rateAudit','exchange-rate-audit'\]/);
  assert.match(pos, /\['lotesSudeban','bank-batch'\]/);
  assert.match(stateMerge, /movimientosCaja/);
  assert.match(stateMerge, /rateAudit/);
  assert.match(eventStore, /movimientosCaja/);
  assert.match(eventStore, /lotesSudeban/);
});

test('la identidad de outbox separa consecutivos iguales pertenecientes a cajas diferentes', () => {
  assert.match(pos, /const BOX_SCOPED_OPERATION_COLLECTIONS = new Set\(\[[^\]]*'movimientosCaja'[^\]]*\]\)/);
  assert.match(pos, /function operationIdentity\(item,index,collection\)/);
  assert.match(pos, /const box=BOX_SCOPED_OPERATION_COLLECTIONS\.has\(collection\)\?String\(item\.cashbox\|\|'sin-caja'\)\+':':''/);
  assert.match(pos, /operationIdentity\(item,index,key\)/);
  assert.match(pos, /operationIdentity\(item,i,key\)/);
});

test('la sincronización no sobrescribe cambios del usuario hechos mientras la petición LAN está en curso', () => {
  assert.match(pos, /do\{\s*pendingSave=window\.__SIFER_LAST_SAVE;\s*captureTask=operationCapturePromise;\s*if\(pendingSave\)await pendingSave;\s*await captureTask;\s*\}while\(pendingSave!==window\.__SIFER_LAST_SAVE\|\|captureTask!==operationCapturePromise\)/);
  assert.match(pos, /const syncRevision=saveSequence/);
  assert.match(pos, /persistenceBlocked\|\|saveSequence===syncRevision/);
  assert.match(pos, /else scheduleNetworkSync\(\)/);
  assert.doesNotMatch(pos, /else mergeRemoteSnapshot\(local,result\.state\)/);
});

test('la sincronización espera tanto la persistencia del snapshot como la captura durable de operaciones', () => {
  assert.match(pos, /let operationCapturePromise=Promise\.resolve\(\)/);
  assert.match(pos, /operationCapturePromise=pending\.then\(\(\)=>undefined,\(\)=>undefined\)/);
  assert.match(pos, /captureTask=operationCapturePromise/);
  assert.match(pos, /await captureTask/);
  assert.match(pos, /captureTask!==operationCapturePromise/);
});

test('el cliente no conserva snapshots locales antiguos por encima del estado autoritativo del servidor', () => {
  assert.doesNotMatch(pos, /function mergeRemoteSnapshot\(local,remote\)/);
  assert.match(pos, /Object\.assign\(S,result\.state\)/);
  assert.match(pos, /saveSequence===syncRevision/);
});

test('el endpoint LAN valida Bearer con comparación constante y nunca compara cadenas directamente', () => {
  assert.match(electron, /require\('\.\/lan-auth\.cjs'\)/);
  assert.match(electron, /hasValidBearerToken\(req\.headers\.authorization, networkConfig\.token\)/);
  assert.doesNotMatch(electron, /req\.headers\.authorization !== 'Bearer ' \+ networkConfig\.token/);
});

test('si falla el bind del servidor LAN restaura la configuración anterior y no deja el equipo marcado como servidor', () => {
  const startup = electron.slice(electron.indexOf('async function startLanServer'), electron.indexOf('function allocateCashboxSequence'));
  assert.match(startup, /const previousConfig = \{ \.\.\.networkConfig \}/);
  assert.match(startup, /networkServer = null/);
  assert.match(startup, /try \{\s*saveNetworkConfig\(\)/);
  assert.match(startup, /catch \(error\) \{\s*stopDiscoveryServer\(\)/);
  assert.match(startup, /networkServer = null/);
  assert.match(startup, /networkConfig = previousConfig/);
  assert.match(startup, /No se pudo iniciar el servidor LAN y tampoco restaurar su configuración anterior/);
});

test('la outbox local del servidor restaura la base SQLite si falla la persistencia del evento', () => {
  const handler = electron.slice(electron.indexOf("ipcMain.handle('network:operation-create'"), electron.indexOf("ipcMain.handle('network:operation-pending'"));
  assert.match(handler, /const databaseBefore = db\.export\(\)/);
  assert.match(handler, /transactionCommitted = true/);
  assert.match(handler, /catch \(persistError\) \{\s*restoreDatabaseSnapshot\(databaseBefore\)/);
  assert.match(handler, /no se confirmó la operación/);
  assert.match(handler, /if \(!transactionCommitted\) \{ try \{ db\.run\('ROLLBACK'\)/);
});

test('la outbox local del servidor rechaza reutilizar un eventId con contenido distinto', () => {
  const handler = electron.slice(electron.indexOf("ipcMain.handle('network:operation-create'"), electron.indexOf("ipcMain.handle('network:operation-pending'"));
  assert.match(handler, /SELECT event_id,device_id,event_type,entity_type,entity_id,occurred_at,payload FROM local_operation_outbox/);
  assert.match(handler, /const sameEvent = duplicate\.device_id === networkConfig\.deviceId/);
  assert.match(handler, /El identificador de operación ya fue usado con datos diferentes/);
});

test('ninguna operación del renderer puede invocar save sin esperar la confirmación durable', () => {
  assert.doesNotMatch(pos, /(?<!await )\bsave\(\)\s*;/);
  assert.match(pos, /const persisted=await save\(\)/);
});

test('los botones de diálogo esperan promesas de persistencia y los cuadros de confirmación propagan el resultado', () => {
  assert.match(pos, /const resolved=result&&typeof result\.then==='function'\?await result:result/);
  assert.match(pos, /if\(W&&W\.el===bd\)closeWin\(\)/);
  assert.match(pos, /const result=b\.fn\(\);[\s\S]{0,200}await result/);
});

test('un fallo de persistencia nunca restaura una instantánea local antigua sobre un estado autoritativo recuperado', () => {
  assert.match(pos, /let recovered=false;\s*const superseded=sequence!==saveSequence/);
  assert.match(pos, /recovered=true;\s*persistenceBlocked=false/);
  assert.match(pos, /return \{ok:false,durable:'none',error,recovered,superseded\}/);
  assert.match(pos, /function restoreStateSnapshotIfNeeded\(result,snapshot\)\{\s*if\(result&&\(result\.recovered\|\|result\.superseded\)\)return false/);
});

test('la reserva de consecutivo CxP captura el estado anterior antes de agregar la obligación', () => {
  const handler = pos.slice(pos.indexOf('function newCxpManualDlg'), pos.indexOf('/* ==========================================================================', pos.indexOf('function newCxpManualDlg')));
  assert.ok(handler.indexOf('const rollbackState=JSON.parse(JSON.stringify(S))') < handler.indexOf('S.cxp.push('));
});

test('un fallo al guardar el Corte Z no puede borrar el último corte histórico por un índice -1', () => {
  assert.match(pos, /const zStateBefore=JSON\.parse\(JSON\.stringify\(S\)\);[\s\S]{0,300}getZHistory\(\)\.push\(z\)/);
  assert.match(pos, /restoreStateSnapshotIfNeeded\(persisted,zStateBefore\)/);
  assert.doesNotMatch(pos, /getZHistory\(\)\.splice\(getZHistory\(\)\.findIndex/);
});

test('el cliente no confirma una escritura hasta que cada evento nuevo recibe ACK durable del servidor', () => {
  assert.match(pos, /async function captureNewOperations\(snapshotOverride\)/);
  assert.match(pos, /delivery\.serverConfirmed!==true\|\|delivery\.status!=='acked'/);
  assert.match(pos, /await captureNewOperations\(state\);\s*return posSqliteDriver\.saveState\(state\)/);
  assert.match(pos, /operationCapturePromise=pending\.then\(\(\)=>undefined,\(\)=>undefined\)/);
  assert.match(electron, /serverConfirmed: !!delivery && delivery\.status === 'acked'/);
});

test('una operación pendiente o conflictiva no se marca como capturada en la línea base del renderer', () => {
  const capture = pos.slice(pos.indexOf('async function captureNewOperations'), pos.indexOf('async function networkSyncAttempt'));
  assert.match(capture, /if\(!delivery\|\|delivery\.serverConfirmed!==true\|\|delivery\.status!=='acked'\)/);
  assert.match(capture, /throw new Error\(delivery&&delivery\.deliveryError/);
  assert.ok(capture.indexOf('seen.add(identity)') > capture.indexOf('delivery.serverConfirmed!==true'));
});

test('el handler de guardado de snapshots cliente vacía y confirma la outbox antes de enviar el snapshot', () => {
  const handler = electron.slice(electron.indexOf("ipcMain.handle('posdb:save-state'"), electron.indexOf("ipcMain.handle('posdb:list-documents'"));
  assert.match(handler, /if \(networkConfig\.role === 'client'\)[\s\S]{0,350}await flushClientOutbox\(\);[\s\S]{0,300}clientApi\('\/api\/sync\/state'/);
});

test('los tombstones de ventas suspendidas se cargan desde el snapshot y sobreviven al reinicio del renderer', () => {
  assert.match(pos, /S\.heldDeletedIds=Array\.isArray\(d\.heldDeletedIds\)\?d\.heldDeletedIds:\[\]/);
  assert.match(pos, /if\(!Array\.isArray\(S\.heldDeletedIds\)\)S\.heldDeletedIds=\[\]/);
  assert.match(pos, /S\.heldDeletedIds\.push\(\{id:String\(hd\.id/);
});

test('si el servidor LAN no puede reanudarse al iniciar, la aplicación falla cerrada y no crea un modo local paralelo', () => {
  assert.match(electron, /if \(networkConfig\.role === 'server'\) \{ try \{ await startLanServer\(networkConfig\.port\); \} catch \(error\) \{ throw new Error\('No se pudo reanudar el servidor LAN/);
  const startup = electron.slice(electron.indexOf('app.whenReady().then'), electron.indexOf("app.on('window-all-closed'"));
  assert.doesNotMatch(startup, /networkConfig\.role = 'standalone'/);
  assert.match(startup, /app\.quit\(\)/);
});
