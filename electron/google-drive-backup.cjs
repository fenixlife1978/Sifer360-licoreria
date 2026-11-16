'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TASK_NAME = 'SIFER360-GoogleDrive-Backup';
const VENEZUELA_OFFSET = '-04:00';
let bundledClientId = '';
try { bundledClientId = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-drive-oauth.json'), 'utf8')).clientId || ''; } catch {}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? require('node:http') : require('node:https');
    const req = transport.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = body.error_description || body.error?.message || body.error || ('HTTP ' + res.statusCode);
          reject(new Error('Google Drive respondió ' + res.statusCode + ': ' + message));
          return;
        }
        resolve({ statusCode: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado al conectar con Google Drive.')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function encryptBackup(bytes, key, cryptoImpl = crypto) {
  const iv = cryptoImpl.randomBytes(12);
  const cipher = cryptoImpl.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('SIFER360GDR1'), iv, tag, encrypted]);
}
function decryptBackup(payload, key, cryptoImpl = crypto) {
  const bytes = Buffer.from(payload);
  const magic = Buffer.from('SIFER360GDR1');
  if (bytes.length < magic.length + 28 || !bytes.subarray(0, magic.length).equals(magic)) throw new Error('El archivo no es un respaldo cifrado SIFER360 reconocido.');
  const iv = bytes.subarray(magic.length, magic.length + 12);
  const tag = bytes.subarray(magic.length + 12, magic.length + 28);
  const decipher = cryptoImpl.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(magic.length + 28)), decipher.final()]);
}

function createDailyTaskXml(executable, args, startDate = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(startDate);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const boundary = date + 'T20:00:00' + VENEZUELA_OFFSET;
  const command = String(executable).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const argText = String(args || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>Respaldo cifrado diario de SIFER360 a Google Drive a las 20:00 hora de Venezuela (UTC-04:00).</Description></RegistrationInfo>
 <Triggers><CalendarTrigger><StartBoundary>${boundary}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
 <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT30M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
 <Actions Context="Author"><Exec><Command>${command}</Command><Arguments>${argText}</Arguments></Exec></Actions>
</Task>`;
}

function createWindowsBackupScheduler({ fsImpl = fs, pathImpl = path, execFile = execFileSync, platform = process.platform } = {}) {
  function configure(executable) {
    if (platform !== 'win32') throw new Error('La programación automática requiere Windows.');
    const xml = createDailyTaskXml(executable, '--sifer-google-drive-backup');
    const temp = pathImpl.join(require('node:os').tmpdir(), 'sifer360-google-drive-task-' + process.pid + '.xml');
    const encoded = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xml, 'utf16le')]);
    fsImpl.writeFileSync(temp, encoded);
    try {
      execFile('schtasks.exe', ['/Create', '/TN', TASK_NAME, '/XML', temp, '/F'], { windowsHide: true, stdio: 'pipe' });
    } finally { try { fsImpl.unlinkSync(temp); } catch {} }
    return { scheduled: true, time: '20:00', timezone: 'America/Caracas', taskName: TASK_NAME };
  }
  function remove() {
    if (platform !== 'win32') return { scheduled: false };
    try { execFile('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], { windowsHide: true, stdio: 'pipe' }); }
    catch (error) { if (!/cannot find|no se encuentra|no existe/i.test(String(error.message || error))) throw error; }
    return { scheduled: false };
  }
  return { configure, remove };
}

function createGoogleDriveBackup(options = {}) {
  const app = options.app;
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const cryptoImpl = options.crypto || crypto;
  const safeStorage = options.safeStorage;
  const shell = options.shell;
  const dialog = options.dialog;
  const httpsImpl = options.https;
  const request = options.requestJson || requestJson;
  const clientId = String(options.clientId || process.env.SIFER360_GOOGLE_OAUTH_CLIENT_ID || bundledClientId || '').trim();
  const directory = pathImpl.join(app.getPath('userData'), 'google-drive-backup');
  const configFile = pathImpl.join(directory, 'config.json');
  const historyFile = pathImpl.join(directory, 'history.json');
  const scheduler = options.scheduler || createWindowsBackupScheduler();
  let activeOAuth = null;

  function ensureDirectory() { fsImpl.mkdirSync(directory, { recursive: true }); }
  function readConfig() {
    ensureDirectory();
    if (!fsImpl.existsSync(configFile)) return { enabled: false, email: '', folderId: '', encryptedRefreshToken: '', encryptedBackupKey: '', lastBackupAt: '', lastBackupStatus: '', lastBackupError: '', schedule: null };
    return JSON.parse(fsImpl.readFileSync(configFile, 'utf8'));
  }
  function writeConfig(config) {
    ensureDirectory();
    const temp = configFile + '.tmp';
    const fd = fsImpl.openSync(temp, 'w', 0o600);
    try { fsImpl.writeFileSync(fd, JSON.stringify(config, null, 2), 'utf8'); fsImpl.fsyncSync(fd); }
    finally { fsImpl.closeSync(fd); }
    fsImpl.renameSync(temp, configFile);
  }
  function protect(value) {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('Windows no tiene disponible el almacén seguro de credenciales. No se guardó el token.');
    return safeStorage.encryptString(value).toString('base64');
  }
  function unprotect(value) {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('No se puede descifrar la autorización de Google en este equipo.');
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
  function getBackupKey(config, create = false) {
    if (config.encryptedBackupKey) return Buffer.from(unprotect(config.encryptedBackupKey), 'base64');
    if (!create) throw new Error('No existe una clave local para descifrar los respaldos.');
    const key = cryptoImpl.randomBytes(32);
    config.encryptedBackupKey = protect(key.toString('base64'));
    writeConfig(config);
    return key;
  }
  function readHistory() {
    try { return JSON.parse(fsImpl.readFileSync(historyFile, 'utf8')); } catch { return []; }
  }
  function writeHistory(entry) {
    const history = readHistory();
    history.unshift(entry);
    fsImpl.writeFileSync(historyFile, JSON.stringify(history.slice(0, 100), null, 2), { mode: 0o600 });
  }
  function status() {
    const config = readConfig();
    return {
      configured: !!config.encryptedRefreshToken,
      enabled: !!config.enabled,
      email: config.email || '',
      lastBackupAt: config.lastBackupAt || '',
      lastBackupStatus: config.lastBackupStatus || '',
      lastBackupError: config.lastBackupError || '',
      schedule: config.schedule || null,
      history: readHistory().slice(0, 10),
      oauthReady: !!clientId
    };
  }
  function requireClientId() {
    if (!clientId) throw new Error('Falta configurar el identificador OAuth de Google (SIFER360_GOOGLE_OAUTH_CLIENT_ID). La conexión no se habilitará hasta registrar la aplicación de escritorio SIFER360 en Google Cloud.');
  }
  async function exchangeToken(params) {
    const body = new URLSearchParams(params).toString();
    const result = await request(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body });
    return result.body;
  }
  async function connect(expectedEmail) {
    requireClientId();
    if (activeOAuth) throw new Error('Ya existe una conexión con Google en curso.');
    const email = String(expectedEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Introduce un correo de Google válido.');
    const state = cryptoImpl.randomBytes(24).toString('hex');
    const verifier = cryptoImpl.randomBytes(32).toString('base64url');
    const challenge = cryptoImpl.createHash('sha256').update(verifier).digest('base64url');
    const server = http.createServer();
    activeOAuth = { server, state };
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      const redirectUri = 'http://127.0.0.1:' + address.port + '/oauth2callback';
      const authUrl = new URL(GOOGLE_AUTH);
      for (const [key, value] of Object.entries({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPE + ' https://www.googleapis.com/auth/userinfo.email',
        access_type: 'offline', prompt: 'consent', login_hint: email, state,
        code_challenge: challenge, code_challenge_method: 'S256'
      })) authUrl.searchParams.set(key, value);
      const callback = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Se agotó el tiempo de autorización de Google.')), 180000);
        server.on('request', async (req, res) => {
          const url = new URL(req.url, redirectUri);
          if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
          if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Estado OAuth inválido.'); clearTimeout(timeout); reject(new Error('La validación de seguridad OAuth no coincide.')); return; }
          if (url.searchParams.get('error')) { res.writeHead(400).end('Autorización cancelada. Puedes cerrar esta ventana.'); clearTimeout(timeout); reject(new Error('Google canceló la autorización: ' + url.searchParams.get('error'))); return; }
          const code = url.searchParams.get('code');
          if (!code) { res.writeHead(400).end('Falta el código de autorización.'); clearTimeout(timeout); reject(new Error('Google no devolvió el código de autorización.')); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><title>SIFER360</title><h2>Google Drive conectado. Puedes cerrar esta ventana y volver a SIFER360.</h2>');
          clearTimeout(timeout);
          resolve(code);
        });
      });
      callback.catch(() => {});
      await shell.openExternal(authUrl.toString());
      const code = await callback;
      const token = await exchangeToken({ code, client_id: clientId, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
      if (!token.refresh_token) throw new Error('Google no entregó un token de renovación. Revoca el acceso de SIFER360 en tu cuenta Google y vuelve a conectar.');
      const profile = await request('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } });
      const actualEmail = String(profile.body.email || '').toLowerCase();
      if (actualEmail !== email) throw new Error('La cuenta autorizada (' + actualEmail + ') no coincide con el correo indicado (' + email + ').');
      const config = readConfig();
      config.email = actualEmail;
      config.encryptedRefreshToken = protect(token.refresh_token);
      getBackupKey(config, true);
      config.enabled = true;
      writeConfig(config);
      return status();
    } finally {
      try { server.close(); } catch {}
      activeOAuth = null;
    }
  }
  async function accessToken(config) {
    if (!config.encryptedRefreshToken) throw new Error('Google Drive no está conectado.');
    const token = await exchangeToken({ client_id: clientId, refresh_token: unprotect(config.encryptedRefreshToken), grant_type: 'refresh_token' });
    return token.access_token;
  }
  async function driveRequest(url, token, opts = {}) {
    const headers = { Authorization: 'Bearer ' + token, ...(opts.headers || {}) };
    return request(url, { method: opts.method || 'GET', headers, body: opts.body, timeout: opts.timeout || 120000 });
  }
  async function ensureFolder(token, config) {
    if (config.folderId) return config.folderId;
    const q = encodeURIComponent("name='SIFER360 Respaldos' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const found = await driveRequest(DRIVE_API + '/files?q=' + q + '&fields=files(id,name)&spaces=drive', token);
    const existing = found.body.files && found.body.files[0];
    if (existing) { config.folderId = existing.id; writeConfig(config); return existing.id; }
    const created = await driveRequest(DRIVE_API + '/files?fields=id', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SIFER360 Respaldos', mimeType: 'application/vnd.google-apps.folder' })
    });
    config.folderId = created.body.id;
    writeConfig(config);
    return config.folderId;
  }
  async function uploadBackup(bytes, token, config, filename, metadata) {
    const folderId = await ensureFolder(token, config);
    const q = encodeURIComponent("name='" + filename.replace(/'/g, "\\'") + "' and '" + folderId + "' in parents and trashed=false");
    const found = await driveRequest(DRIVE_API + '/files?q=' + q + '&fields=files(id,name)', token);
    const existing = found.body.files && found.body.files[0];
    const boundary = 'sifer360_' + cryptoImpl.randomBytes(12).toString('hex');
    const meta = JSON.stringify(existing ? { description: metadata.description } : { name: filename, parents: [folderId], description: metadata.description });
    const prefix = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n');
    const suffix = Buffer.from('\r\n--' + boundary + '--');
    const body = Buffer.concat([prefix, bytes, suffix]);
    const endpoint = existing ? DRIVE_UPLOAD + '/files/' + existing.id + '?uploadType=multipart&fields=id,name,size,modifiedTime' : DRIVE_UPLOAD + '/files?uploadType=multipart&fields=id,name,size,modifiedTime';
    return driveRequest(endpoint, token, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary, 'Content-Length': body.length },
      body
    });
  }
  async function backup(snapshotBytes, { manual = false, jsonBytes = null } = {}) {
    const config = readConfig();
    if (!config.enabled || !config.encryptedRefreshToken) throw new Error('El respaldo automático en Google Drive no está activado o la cuenta no está conectada.');
    if (!snapshotBytes || !Buffer.from(snapshotBytes).length) throw new Error('La instantánea SQLite está vacía; no se enviará ningún archivo.');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const key = getBackupKey(config);
    const filename = 'SIFER360-' + day + '.sqlite.siferenc';
    const encrypted = encryptBackup(snapshotBytes, key, cryptoImpl);
    const sha256 = cryptoImpl.createHash('sha256').update(snapshotBytes).digest('hex');
    const token = await accessToken(config);
    const uploaded = await uploadBackup(encrypted, token, config, filename, {
      description: 'Respaldo SQLite cifrado AES-256-GCM; SHA-256 ' + sha256 + '; fecha ' + day + '; hora Venezuela.'
    });
    let jsonResult = null;
    if (jsonBytes && Buffer.from(jsonBytes).length) {
      const jsonName = 'SIFER360-' + day + '.json.siferenc';
      const encryptedJson = encryptBackup(jsonBytes, key, cryptoImpl);
      const jsonSha256 = cryptoImpl.createHash('sha256').update(jsonBytes).digest('hex');
      const uploadedJson = await uploadBackup(encryptedJson, token, config, jsonName, {
        description: 'Exportación completa JSON de las tablas SQLite, cifrada AES-256-GCM; SHA-256 JSON ' + jsonSha256 + '; fecha ' + day + '.'
      });
      jsonResult = { fileId: uploadedJson.body.id, fileName: uploadedJson.body.name, size: Number(uploadedJson.body.size || encryptedJson.length), sha256: jsonSha256 };
    }
    const result = { ok: true, fileId: uploaded.body.id, fileName: uploaded.body.name, size: Number(uploaded.body.size || encrypted.length), sha256, json: jsonResult, date: day, manual };
    config.lastBackupAt = new Date().toISOString();
    config.lastBackupStatus = 'success';
    config.lastBackupError = '';
    writeConfig(config);
    writeHistory({ ...result, at: config.lastBackupAt });
    return result;
  }
  async function runBackup(snapshotBytes, opts) {
    try { return await backup(snapshotBytes, opts); }
    catch (error) {
      const config = readConfig();
      config.lastBackupAt = new Date().toISOString();
      config.lastBackupStatus = 'error';
      config.lastBackupError = String(error.message || error).slice(0, 500);
      writeConfig(config);
      writeHistory({ ok: false, at: config.lastBackupAt, error: config.lastBackupError });
      throw error;
    }
  }
  async function enable(executable) {
    const config = readConfig();
    if (!config.encryptedRefreshToken) throw new Error('Primero conecta una cuenta Google Drive.');
    if (!config.recoveryKeyExported) throw new Error('Antes de activar el respaldo diario, guarda la clave de recuperación fuera de este equipo.');
    config.enabled = true;
    config.schedule = scheduler.configure(executable);
    writeConfig(config);
    return status();
  }
  function disable() {
    const config = readConfig();
    config.enabled = false;
    config.schedule = scheduler.remove();
    writeConfig(config);
    return status();
  }
  async function exportRecoveryKey() {
    const config = readConfig();
    const key = getBackupKey(config);
    const result = await dialog.showSaveDialog({
      title: 'Guardar clave de recuperación de respaldos SIFER360',
      defaultPath: 'SIFER360-clave-recuperacion.txt',
      buttonLabel: 'Guardar clave',
      filters: [{ name: 'Clave de recuperación', extensions: ['txt'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fsImpl.writeFileSync(result.filePath, 'SIFER360-LICORERIA - CLAVE DE RECUPERACIÓN DE RESPALDOS\nGuarde este archivo fuera del equipo. Sin esta clave no podrá descifrar los respaldos en otra PC.\n\n' + key.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
    config.recoveryKeyExported = true;
    writeConfig(config);
    return { saved: true, filePath: result.filePath };
  }
  function verifyBackup(payload, recoveryKey) {
    const key = recoveryKey ? Buffer.from(String(recoveryKey).trim(), 'base64') : getBackupKey(readConfig());
    if (key.length !== 32) throw new Error('La clave de recuperación no tiene el formato esperado.');
    return decryptBackup(payload, key, cryptoImpl);
  }
  return { status, connect, enable, disable, runBackup, exportRecoveryKey, verifyBackup, getBackupKey, readConfig };
}

module.exports = { createGoogleDriveBackup, createWindowsBackupScheduler, createDailyTaskXml, encryptBackup, decryptBackup };
