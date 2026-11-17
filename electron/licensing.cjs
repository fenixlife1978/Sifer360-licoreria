const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CRM_BASE_URL = 'https://crm-sicoven.vercel.app';
const PRODUCT_CODE = 'SIFER360_LICORERIA';
const PLANS_URL = CRM_BASE_URL + '/comprar?productId=prod-sifer360-licoreria';
const ACTIVATION_URL = CRM_BASE_URL + '/api/activations';
const TELEMETRY_URL = CRM_BASE_URL + '/api/analytics/events';
const TRIAL_MS = 24 * 60 * 60 * 1000;
const APP_VERSION = '1.0.5';
const LICENSE_PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAMK05zLaqyrSkJ/eti0YVq/NLGFmjTJc+T66yKYskEi8=\\n-----END PUBLIC KEY-----\\n';

function createLicensing(options = {}) {
  const app = options.app;
  const safeStorage = options.safeStorage;
  const shell = options.shell;
  const fetchImpl = options.fetchImpl || global.fetch;
  const now = options.now || (() => Date.now());
  const appVersion = typeof app.getVersion === 'function' ? app.getVersion() : APP_VERSION;
  const publicKey = options.publicKey || crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM);
  if (!app || !safeStorage || typeof fetchImpl !== 'function') throw new Error('La integración de licencias requiere Electron safeStorage y fetch.');
  const statePath = path.join(app.getPath('userData'), 'sifer360-license-state.json');
  let state = null;
  let lastRefreshAt = 0;
  let refreshPromise = null;

  function persist() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado seguro del sistema no está disponible. No se guardará información de licencia en texto claro.');
    const encrypted = safeStorage.encryptString(JSON.stringify(state)).toString('base64');
    const temporary = statePath + '.tmp';
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, encrypted }), { mode: 0o600 });
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, statePath);
  }

  function load() {
    if (!fs.existsSync(statePath)) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('No se puede descifrar la licencia porque el cifrado seguro del sistema no está disponible.');
    const envelope = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error('El archivo de licencia local tiene un formato inválido; no se reiniciará la prueba gratuita.');
    const decoded = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'));
    const parsed = JSON.parse(decoded);
    if (!parsed || parsed.version !== 1 || typeof parsed.installationId !== 'string') throw new Error('El registro de licencia local está incompleto; no se reiniciará la prueba gratuita.');
    return parsed;
  }

  function telemetry(eventType, extra = {}) {
    if (!state || state.telemetryEnabled !== true) return Promise.resolve(false);
    const sessionId = crypto.createHash('sha256').update(state.installationId).digest('hex').slice(0, 48);
    const payload = {
      product_code: PRODUCT_CODE,
      event_type: eventType,
      session_id: sessionId,
      source: 'sifer360-desktop',
      medium: process.platform,
      campaign: appVersion,
      landing_path: 'desktop/' + eventType
    };
    if (extra && typeof extra.detail === 'string') payload.landing_path = ('desktop/' + eventType + '/' + extra.detail).slice(0, 300);
    return fetchImpl(TELEMETRY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3500)
    }).then(response => response.ok).catch(() => false);
  }

  function ensureState() {
    if (state) return { created: false };
    const loaded = load();
    if (loaded) {
      state = loaded;
      return { created: false };
    }
    const timestamp = new Date(now()).toISOString();
    state = {
      version: 1,
      installationId: crypto.randomUUID(),
      trialStartedAt: timestamp,
      lastSeenAt: timestamp,
      licenseKey: null,
      licenseId: null,
      lastVerifiedAt: null,
      offlineDays: 7,
      licenseStatus: null,
      telemetryEnabled: true,
      trialExpiredEventSent: false
    };
    persist();
    return { created: true };
  }

  function verifyOfflineToken(token, expectedLicenseId) {
    try {
      if (typeof token !== 'string' || !token) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const payloadBytes = Buffer.from(parts[0], 'base64url');
      const signature = Buffer.from(parts[1], 'base64url');
      if (!crypto.verify(null, payloadBytes, publicKey, signature)) return null;
      const payload = JSON.parse(payloadBytes.toString('utf8'));
      if (payload.v !== 1 || payload.productCode !== PRODUCT_CODE) return null;
      if (payload.installationId !== state.installationId || payload.licenseId !== expectedLicenseId) return null;
      const issuedAt = Date.parse(payload.issuedAt || '');
      const offlineUntil = Date.parse(payload.offlineUntil || '');
      const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : Infinity;
      if (!Number.isFinite(issuedAt) || !Number.isFinite(offlineUntil) || !Number.isFinite(expiresAt) && expiresAt !== Infinity) return null;
      if (issuedAt > now() + 5 * 60 * 1000 || now() > offlineUntil || now() > expiresAt) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function localStatus() {
    ensureState();
    const current = now();
    const lastSeen = Date.parse(state.lastSeenAt || state.trialStartedAt);
    if (Number.isFinite(lastSeen) && current + 5 * 60 * 1000 < lastSeen) {
      return { state: 'clock_error', blocked: true, message: 'La fecha del equipo retrocedió. Corrige la fecha y hora para comprobar la licencia.', telemetryEnabled: state.telemetryEnabled };
    }
    state.lastSeenAt = new Date(current).toISOString();
    persist();

    if (state.licenseKey) {
      const claims = verifyOfflineToken(state.offlineToken, state.licenseId);
      const offlineDays = Math.max(1, Math.min(30, Number(state.offlineDays) || 7));
      if (claims && state.licenseStatus !== 'revoked') {
        const offlineUntil = Date.parse(claims.offlineUntil);
        const offline = !lastRefreshAt || current - lastRefreshAt > 5 * 60 * 1000;
        return {
          state: offline ? 'licensed_offline' : 'licensed',
          blocked: false,
          licenseId: state.licenseId,
          offlineDays,
          lastVerifiedAt: state.lastVerifiedAt,
          offlineUntil: claims.offlineUntil,
          offlineRemainingMs: Math.max(0, offlineUntil - current),
          telemetryEnabled: state.telemetryEnabled
        };
      }
      return { state: state.licenseStatus === 'revoked' ? 'revoked' : 'license_expired', blocked: true, telemetryEnabled: state.telemetryEnabled, message: 'El token de licencia firmado no es válido o superó su margen offline. Conéctate a CRM-SICOVEN para revalidar.' };
    }

    const started = Date.parse(state.trialStartedAt);
    const elapsed = current - started;
    const remainingMs = Math.max(0, TRIAL_MS - elapsed);
    if (!Number.isFinite(started) || elapsed >= TRIAL_MS || state.trialExpiredEventSent) {
      if (!state.trialExpiredEventSent) {
        state.trialExpiredEventSent = true;
        persist();
        telemetry('trial_expired');
      }
      return { state: 'trial_expired', blocked: true, trialStartedAt: state.trialStartedAt, telemetryEnabled: state.telemetryEnabled, message: 'La prueba gratuita de 24 horas terminó. Activa una licencia para continuar.' };
    }
    return { state: 'trial', blocked: false, trialStartedAt: state.trialStartedAt, trialExpiresAt: new Date(started + TRIAL_MS).toISOString(), remainingMs, telemetryEnabled: state.telemetryEnabled };
  }

  async function postActivation() {
    const response = await fetchImpl(ACTIVATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        licenseKey: state.licenseKey,
        productCode: PRODUCT_CODE,
        installationId: state.installationId,
        deviceLabel: os.hostname().slice(0, 120)
      }),
      signal: AbortSignal.timeout(7000)
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body.error || 'No se pudo validar la licencia en CRM-SICOVEN.');
      error.status = response.status;
      throw error;
    }
    if (!body.ok || !body.license || body.license.productCode !== PRODUCT_CODE) throw new Error('CRM-SICOVEN no confirmó una licencia válida para SIFER360 LICORERÍA.');
    if (!verifyOfflineToken(body.offlineToken, String(body.license.id))) throw new Error('CRM-SICOVEN no entregó un token offline firmado y válido para esta instalación.');
    return body;
  }

  async function refresh(force = false) {
    ensureState();
    if (!state.licenseKey) return localStatus();
    if (!force && refreshPromise) return refreshPromise;
    if (!force && now() - lastRefreshAt < 5 * 60 * 1000) return localStatus();
    refreshPromise = (async () => {
      try {
        const result = await postActivation();
        state.licenseId = result.license.id;
        state.offlineToken = result.offlineToken;
        state.licenseStatus = 'active';
        state.offlineDays = Math.max(1, Math.min(30, Number(result.license.offlineDays) || 7));
        state.lastVerifiedAt = new Date(now()).toISOString();
        lastRefreshAt = now();
        persist();
        telemetry('license_check');
        return localStatus();
      } catch (error) {
        const status = Number(error && error.status);
        if (status === 403 || status === 409) {
          telemetry('app_error', { detail: 'license_' + status });
          state.licenseStatus = 'revoked';
          persist();
          return { state: 'revoked', blocked: true, message: error.message || 'Licencia inválida, vencida, revocada o sin equipos disponibles.', telemetryEnabled: state.telemetryEnabled };
        }
        lastRefreshAt = 0;
        telemetry('app_error', { detail: 'crm_connection' });
        const offline = localStatus();
        if (offline.state === 'licensed' || offline.state === 'licensed_offline') return { ...offline, state: 'licensed_offline', message: 'CRM no está disponible. Se mantiene la autorización offline temporal.' };
        return { ...offline, connectionError: error.message || 'No se pudo conectar con CRM-SICOVEN.' };
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function activate(licenseKey) {
    ensureState();
    const key = String(licenseKey || '').trim().toUpperCase();
    if (!key || key.length > 120 || !/^[A-Z0-9-]+$/.test(key)) throw new Error('Introduce una clave de licencia válida.');
    const previousState = { ...state };
    state.licenseKey = key;
    try {
      const result = await postActivation();
      state.licenseId = result.license.id;
      state.offlineToken = result.offlineToken;
      state.licenseStatus = 'active';
      state.offlineDays = Math.max(1, Math.min(30, Number(result.license.offlineDays) || 7));
      state.lastVerifiedAt = new Date(now()).toISOString();
      lastRefreshAt = now();
      persist();
      telemetry('license_activated');
      return localStatus();
    } catch (error) {
      const status = Number(error && error.status);
      telemetry('app_error', { detail: 'activation_' + (status || 'connection') });
      state = previousState;
      persist();
      throw error;
    }
  }

  function setTelemetryEnabled(enabled) {
    ensureState();
    state.telemetryEnabled = enabled === true;
    persist();
    return { telemetryEnabled: state.telemetryEnabled };
  }

  async function initialize() {
    const result = ensureState();
    if (result.created) telemetry('trial_started');
    telemetry('app_launch');
    return localStatus();
  }

  async function openPlans() {
    if (!shell || typeof shell.openExternal !== 'function') throw new Error('No se pudo abrir el catálogo comercial.');
    await shell.openExternal(PLANS_URL);
    return { ok: true };
  }

  return {
    initialize,
    status: () => localStatus(),
    refresh,
    activate,
    setTelemetryEnabled,
    openPlans,
    constants: { productCode: PRODUCT_CODE, trialHours: 24, crmBaseUrl: CRM_BASE_URL, plansUrl: PLANS_URL }
  };
}

module.exports = { createLicensing, PRODUCT_CODE, CRM_BASE_URL, PLANS_URL, TRIAL_MS };
