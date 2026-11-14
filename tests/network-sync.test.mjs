import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const electron = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

test('el ejecutable implementa un servidor LAN con puerto configurable', () => {
  assert.match(electron, /http\.createServer/);
  assert.match(electron, /network:configure-server/);
  assert.match(electron, /listen\(port, '0\.0\.0\.0'/);
  assert.match(electron, /network:stop-server/);
});

test('las rutas de sincronización requieren clave de emparejamiento', () => {
  assert.match(electron, /authorization !== 'Bearer ' \+ networkConfig\.token/);
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
  assert.match(pos, /Sin confirmación del servidor · la última operación puede no estar guardada/);
  assert.match(pos, /const pending=posSqliteDriver\.saveState\(state\)\.then/);
});

test('el administrador tiene panel para servidor y clientes LAN', () => {
  assert.match(ui, /Red y sincronización/);
  assert.match(ui, /Activar esta caja como servidor/);
  assert.match(ui, /Conectar esta caja como cliente/);
  assert.match(ui, /IP DETECTADA/);
});

test('el panel explica límites de red y recomienda reserva de IP', () => {
  assert.match(ui, /Reserva esta IP en el router/);
  assert.match(ui, /no cifra el tráfico/);
  assert.match(ui, /diferencias de inventario por ventas simultáneas requieren conciliación/);
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
  assert.ok(ui.includes('No hace falta configurar IP fija'));
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
  assert.match(electron, /device-sequence-already-used/);
  assert.match(electron, /eventResult\.duplicates/);
  assert.match(preload, /networkCreateOperation/);
  assert.match(preload, /networkOperationStatus/);
});

test('el POS convierte nuevos registros operativos en eventos de la cola local', () => {
  assert.match(pos, /OPERATION_COLLECTIONS/);
  assert.match(pos, /\['sales','sale'\]/);
  assert.match(pos, /\['purchases','purchase'\]/);
  assert.match(pos, /captureNewOperations\(\)/);
  assert.match(pos, /networkCreateOperation\(/);
  assert.match(pos, /primeOperationBaseline\(\)/);
});

test('el servidor aplica una operación nueva una sola vez y reporta entidades en conflicto', () => {
  assert.match(electron, /allowedCollections/);
  assert.match(electron, /existingRecord/);
  assert.match(electron, /entity-already-exists-with-different-data/);
  assert.match(electron, /network_received_operations/);
  assert.match(electron, /conflictIds/);
});

test('el servidor separa identificadores iguales cuando pertenecen a cajas distintas', () => {
  assert.match(electron, /const boxScopedCollections = new Set\(\['sales','purchases','cxc','cxp','cortesZ','counts','openings','movements','returns','voids','retencionesIva','retentions','casheaMovimientos'\]\)/);
  assert.match(electron, /String\(record\.cashbox \|\| 'sin-caja'\) \+ ':' \+ recordId/);
  assert.match(electron, /recordIdentity\(item\) === incomingIdentity/);
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
  assert.match(electron, /'casheaLiquidaciones'/);
  assert.match(electron, /allowedCollections\.has\(collection\)/);
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
  assert.match(electron, /const backup = file \+ '\.bak'/);
  assert.match(electron, /file \+ '\.corrupt-'/);
  assert.match(electron, /integrity_check/);
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
  assert.match(electron, /!allowedCollections\.has\(collection\) \|\| !record/);
  assert.match(electron, /La operación no contiene una entidad permitida y un registro válido/);
});

test('reutilizar un eventId con contenido distinto se marca como conflicto y no como duplicado', () => {
  assert.match(electron, /event-id-reused-with-different-data/);
  assert.match(electron, /existing\.payload === eventPayload/);
  assert.match(electron, /if \(sameEvent\) duplicates\.push/);
});


test('un cliente no transmite claves ni datos a hosts fuera de la red local', () => {
  assert.match(electron, /function assertLanHost\(host\)/);
  assert.match(electron, /if \(!isLanAddress\(host\)\) throw new Error/);
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
  assert.doesNotMatch(capture, /__SIFER_LAST_SAVE/);
});
