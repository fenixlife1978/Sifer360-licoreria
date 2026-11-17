const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLicensing, PRODUCT_CODE, TRIAL_MS } = require('../electron/licensing.cjs');

function fixture(fetchImpl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-license-test-'));
  let currentTime = Date.now();
  const calls = [];
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const signActivationResponse = options => {
    const request = JSON.parse(options.body);
    const payload = {
      v: 1,
      licenseId: 'license-1',
      productCode: PRODUCT_CODE,
      installationId: request.installationId,
      issuedAt: new Date(currentTime).toISOString(),
      offlineUntil: new Date(currentTime + 7 * 86400000).toISOString(),
      expiresAt: null
    };
    const bytes = Buffer.from(JSON.stringify(payload));
    const token = bytes.toString('base64url') + '.' + crypto.sign(null, bytes, keyPair.privateKey).toString('base64url');
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, activation: { id: 'activation-1', status: 'active' }, license: { id: 'license-1', productCode: PRODUCT_CODE, status: 'active', offlineDays: 7 }, offlineToken: token })
    };
  };
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
  const app = { getPath: () => directory };
  const shell = { openExternal: async url => { calls.push({ url }); } };
  const licensing = createLicensing({
    app,
    safeStorage: storage,
    shell,
    now: () => currentTime,
    publicKey: keyPair.publicKey,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options && options.body ? JSON.parse(options.body) : null });
      if (fetchImpl) return fetchImpl(url, options, calls, signActivationResponse);
      if (String(url).includes('/api/activations')) return signActivationResponse(options);
      return { ok: true, status: 202, json: async () => ({ ok: true }) };
    }
  });
  return {
    licensing,
    calls,
    directory,
    signActivationResponse,
    setNow: value => { currentTime = value; },
    advance: value => { currentTime += value; },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

test('starts a local 24-hour trial automatically and records a stable installation id', async () => {
  const f = fixture();
  try {
    const initial = await f.licensing.initialize();
    assert.equal(initial.state, 'trial');
    assert.equal(initial.blocked, false);
    assert.equal(initial.remainingMs, TRIAL_MS);
    const status = f.licensing.status();
    assert.equal(status.state, 'trial');
    assert.ok(status.trialStartedAt);
    assert.equal(f.calls.some(call => call.body && call.body.event_type === 'trial_started'), true);
  } finally { f.cleanup(); }
});

test('blocks access after the 24-hour trial expires', async () => {
  const f = fixture();
  try {
    await f.licensing.initialize();
    f.advance(TRIAL_MS + 1);
    const status = f.licensing.status();
    assert.equal(status.state, 'trial_expired');
    assert.equal(status.blocked, true);
    assert.equal(f.calls.some(call => call.body && call.body.event_type === 'trial_expired'), true);
  } finally { f.cleanup(); }
});

test('activates only the SIFER360 product and stores the key encrypted', async () => {
  const f = fixture();
  try {
    await f.licensing.initialize();
    const status = await f.licensing.activate('SIC-ABCD1234-EF567890-12345678');
    assert.equal(status.state, 'licensed');
    assert.equal(status.blocked, false);
    const activation = f.calls.find(call => call.url && String(call.url).includes('/api/activations'));
    assert.equal(activation.body.productCode, 'SIFER360_LICORERIA');
    assert.ok(activation.body.installationId);
    const stored = JSON.parse(fs.readFileSync(path.join(f.directory, 'sifer360-license-state.json'), 'utf8'));
    assert.equal(stored.version, 1);
    assert.ok(stored.encrypted);
    assert.equal(JSON.stringify(stored).includes('SIC-ABCD1234-EF567890-12345678'), false);
  } finally { f.cleanup(); }
});

test('allows a previously validated license offline for the CRM-provided grace period only', async () => {
  let offline = false;
  const f = fixture(async (url, options, calls, signActivationResponse) => {
    if (String(url).includes('/api/activations') && offline) throw new Error('network unavailable');
    if (String(url).includes('/api/activations')) return signActivationResponse(options);
    return { ok: true, status: 202, json: async () => ({ ok: true }) };
  });
  try {
    await f.licensing.initialize();
    await f.licensing.activate('SIC-ABCD1234-EF567890-12345678');
    offline = true;
    const offlineStatus = await f.licensing.refresh(true);
    assert.equal(offlineStatus.state, 'licensed_offline');
    assert.equal(offlineStatus.blocked, false);
    f.advance(7 * 86400000 + 1);
    const expired = f.licensing.status();
    assert.equal(expired.state, 'license_expired');
    assert.equal(expired.blocked, true);
  } finally { f.cleanup(); }
});

test('revoked or product-mismatched licenses are blocked when CRM responds 403', async () => {
  let rejectActivation = false;
  const f = fixture(async (url, options, calls, signActivationResponse) => {
    if (String(url).includes('/api/activations') && rejectActivation) return {
      ok: false, status: 403, json: async () => ({ error: 'Licencia inválida, vencida o revocada.' })
    };
    if (String(url).includes('/api/activations')) return signActivationResponse(options);
    return { ok: true, status: 202, json: async () => ({ ok: true }) };
  });
  try {
    await f.licensing.initialize();
    await f.licensing.activate('SIC-ABCD1234-EF567890-12345678');
    rejectActivation = true;
    const result = await f.licensing.refresh(true);
    assert.equal(result.state, 'revoked');
    assert.equal(result.blocked, true);
  } finally { f.cleanup(); }
});

test('telemetry can be disabled and plans open the isolated SIFER360 purchase page', async () => {
  const f = fixture();
  try {
    await f.licensing.initialize();
    await f.licensing.setTelemetryEnabled(false);
    await f.licensing.activate('SIC-ABCD1234-EF567890-12345678');
    assert.equal(f.calls.some(call => call.body && call.body.event_type === 'license_activated'), false);
    await f.licensing.openPlans();
    assert.equal(f.calls.some(call => call.url === 'https://crm-sicoven.vercel.app/comprar?productId=prod-sifer360-licoreria'), true);
  } finally { f.cleanup(); }
});

test('rejects a license response without a valid Ed25519 offline token', async () => {
  const f = fixture(async url => {
    if (String(url).includes('/api/activations')) return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, activation: { id: 'activation-1', status: 'active' }, license: { id: 'license-1', productCode: PRODUCT_CODE, status: 'active', offlineDays: 7 }, offlineToken: 'forged.payload' })
    };
    return { ok: true, status: 202, json: async () => ({ ok: true }) };
  });
  try {
    await f.licensing.initialize();
    await assert.rejects(() => f.licensing.activate('SIC-ABCD1234-EF567890-12345678'), /token offline firmado/);
    assert.equal(f.licensing.status().state, 'trial');
  } finally { f.cleanup(); }
});

test('detects a backwards system clock instead of extending the trial', async () => {
  const f = fixture();
  try {
    await f.licensing.initialize();
    f.advance(-10 * 60 * 1000);
    const status = f.licensing.status();
    assert.equal(status.state, 'clock_error');
    assert.equal(status.blocked, true);
  } finally { f.cleanup(); }
});
