import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');

test('los consecutivos se almacenan en SQLite con clave compuesta caja + tipo de operación', () => {
  assert.match(main, /CREATE TABLE IF NOT EXISTS cashbox_sequences/);
  assert.match(main, /PRIMARY KEY \(cashbox_id, operation_type\)/);
  assert.match(main, /last_value INTEGER NOT NULL DEFAULT 0/);
});

test('la reserva correlativa incrementa atómicamente y nunca comparte secuencias entre cajas', () => {
  assert.match(main, /function allocateCashboxSequence\(cashboxId, operationType, minimumValue = 1\)/);
  assert.match(main, /db\.run\('BEGIN IMMEDIATE'\)/);
  assert.match(main, /MAX\(last_value,\?\)\+1/);
  assert.match(main, /COMMIT/);
  assert.match(main, /persistDb\(\)/);
});

test('los clientes reservan números exclusivamente en el servidor LAN autenticado', () => {
  assert.match(main, /\/api\/sequences\/next/);
  assert.match(main, /networkConfig\.role === 'client'/);
  assert.match(main, /Authorization: 'Bearer ' \+ networkConfig\.token/);
  assert.match(main, /expectedHash: networkConfig\.serverStateHash/);
  assert.match(main, /statePayloadHash/);
  assert.match(main, /sendJson\(res, 409/);
  assert.match(main, /body\.expectedHash !== currentHash/);
  assert.match(main, /networkConfig\.serverStateHash = eventResult\.stateHash/);
  assert.match(main, /network:next-sequence/);
  assert.match(preload, /networkNextSequence: input => ipcRenderer\.invoke\('network:next-sequence', input\)/);
});

test('ventas, números de control, anulaciones y cortes Z solicitan correlativos al SQLite central', () => {
  assert.match(pos, /async function nextCajaSequence\(operation,box=currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('invoice',box\)/);
  assert.match(pos, /nextCajaSequence\('control',currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('void',currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('z',box\)/);
  assert.match(pos, /nextCajaSequence\('purchase',currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('count',currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('cxc',currentCaja\(\)\)/);
  assert.match(pos, /nextCajaSequence\('cxp',currentCaja\(\)\)/);
  assert.match(pos, /ANU-'.*pad\(voidNo,6\)/);
  assert.match(pos, /const saveBulk=async\(\)=>/);
  assert.match(pos, /const processPurchase=async\(\)=>/);
});

test('las PCs cliente cargan y guardan el estado operativo mediante el servidor, no desde su SQLite local', () => {
  assert.match(main, /posdb:load-state', async/);
  assert.match(main, /source: 'lan-server'/);
  assert.match(main, /posdb:save-state', async/);
  assert.match(main, /El servidor no confirmó el guardado central/);
  assert.match(main, /serverStateHash = result\.stateHash/);
  assert.match(main, /server-sqlite/);
});

test('la interfaz permite iniciar servidor, descubrir equipos y emparejar clientes por IP y clave', () => {
  assert.match(pos, /function networkSettingsDlg\(\)/);
  assert.match(pos, /networkStartServer/);
  assert.match(pos, /networkDiscover/);
  assert.match(pos, /networkConfigureClient/);
  assert.match(pos, /networkDisconnectClient/);
  assert.match(pos, /Conexión de red local \(LAN\)/);
});
