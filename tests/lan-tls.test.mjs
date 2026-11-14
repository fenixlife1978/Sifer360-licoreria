import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ensureServerCertificate, verifyFingerprint, createPinnedAgent, retrievePeerCertificate } = require('../electron/lan-tls.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-lan-tls-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('el certificado TLS del servidor se genera una sola vez y conserva su huella entre reinicios', async t => {
  const directory = fixture(t);
  const first = await ensureServerCertificate({ directory, deviceId: 'server-01' });
  const restarted = await ensureServerCertificate({ directory, deviceId: 'server-01' });
  assert.match(first.fingerprint, /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  assert.equal(restarted.fingerprint, first.fingerprint);
  assert.equal(restarted.cert, first.cert);
  assert.equal(restarted.key, first.key);
});

test('la identidad TLS no se regenera silenciosamente para otro dispositivo', async t => {
  const directory = fixture(t);
  await ensureServerCertificate({ directory, deviceId: 'server-01' });
  await assert.rejects(
    ensureServerCertificate({ directory, deviceId: 'server-02' }),
    /no coincide con este servidor/
  );
});

test('la huella SHA-256 se compara de forma estricta e independiente del formato con separadores', async t => {
  const directory = fixture(t);
  const identity = await ensureServerCertificate({ directory, deviceId: 'server-01' });
  assert.equal(verifyFingerprint(identity.fingerprint, identity.fingerprint.replaceAll(':', '').toLowerCase()), true);
  assert.equal(verifyFingerprint(identity.fingerprint, '00'.repeat(32)), false);
  assert.equal(verifyFingerprint('invalid', identity.fingerprint), false);
});

test('el cliente obtiene el certificado público sin enviar la clave de emparejamiento', async t => {
  const directory = fixture(t);
  const identity = await ensureServerCertificate({ directory, deviceId: 'server-01' });
  let authorizationHeader;
  const server = https.createServer({ key: identity.key, cert: identity.cert }, (req, res) => {
    authorizationHeader = req.headers.authorization;
    res.writeHead(401);
    res.end('Unauthorized');
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const peer = await retrievePeerCertificate('127.0.0.1', port);
  assert.equal(peer.fingerprint, identity.fingerprint);
  const peerCert = new (require('node:crypto').X509Certificate)(peer.certificate);
  assert.equal(peerCert.fingerprint256, identity.fingerprint);
  assert.equal(authorizationHeader, undefined);
});

test('el agente HTTPS exige la huella del certificado fijado', async t => {
  const directory = fixture(t);
  const identity = await ensureServerCertificate({ directory, deviceId: 'server-01' });
  const agent = createPinnedAgent(identity.cert, identity.fingerprint);
  const server = https.createServer({ key: identity.key, cert: identity.cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => { agent.destroy(); return new Promise(resolve => server.close(resolve)); });
  const result = await new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port: server.address().port, path: '/', agent }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.throws(() => createPinnedAgent(identity.cert, '00'.repeat(32)), /huella configurada no coincide/);
});

test('un certificado de otra PC no supera el pin TLS del servidor esperado', async t => {
  const directoryA = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-lan-tls-a-'));
  const directoryB = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-lan-tls-b-'));
  t.after(() => { fs.rmSync(directoryA, { recursive: true, force: true }); fs.rmSync(directoryB, { recursive: true, force: true }); });
  const expected = await ensureServerCertificate({ directory: directoryA, deviceId: 'server-a' });
  const impostor = await ensureServerCertificate({ directory: directoryB, deviceId: 'server-b' });
  const agent = createPinnedAgent(expected.cert, expected.fingerprint);
  const server = https.createServer({ key: impostor.key, cert: impostor.cert }, (_req, res) => res.end('unexpected'));
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => { agent.destroy(); return new Promise(resolve => server.close(resolve)); });
  await assert.rejects(new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port: server.address().port, path: '/', agent }, response => {
      response.resume();
      response.on('end', () => resolve());
    }).on('error', reject);
  }));
});

test('la clave privada TLS se cifra y descifra mediante el almacén seguro del sistema operativo', async t => {
  const directory = fixture(t);
  const encryptPrivateKey = pem => Buffer.from(pem, 'utf8').toString('base64');
  const decryptPrivateKey = value => Buffer.from(value, 'base64').toString('utf8');
  const first = await ensureServerCertificate({ directory, deviceId: 'server-secure', encryptPrivateKey, decryptPrivateKey });
  const file = path.join(directory, 'sifer360-lan-identity-v1.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(typeof stored.keyEncrypted, 'string');
  assert.equal(Object.hasOwn(stored, 'key'), false);
  const restarted = await ensureServerCertificate({ directory, deviceId: 'server-secure', encryptPrivateKey, decryptPrivateKey });
  assert.equal(restarted.fingerprint, first.fingerprint);
});

test('una identidad TLS heredada se migra a clave cifrada sin cambiar su huella', async t => {
  const directory = fixture(t);
  const legacy = await ensureServerCertificate({ directory, deviceId: 'server-legacy' });
  const encryptPrivateKey = pem => Buffer.from(pem, 'utf8').toString('base64');
  const decryptPrivateKey = value => Buffer.from(value, 'base64').toString('utf8');
  const migrated = await ensureServerCertificate({ directory, deviceId: 'server-legacy', encryptPrivateKey, decryptPrivateKey });
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'sifer360-lan-identity-v1.json'), 'utf8'));
  assert.equal(migrated.fingerprint, legacy.fingerprint);
  assert.equal(typeof stored.keyEncrypted, 'string');
  assert.equal(Object.hasOwn(stored, 'key'), false);
});

test('devuelve la clave privada descifrada al servidor HTTPS aunque esté cifrada en disco', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-tls-encrypted-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const encryptPrivateKey = pem => Buffer.from(pem, 'utf8').toString('base64');
  const decryptPrivateKey = value => Buffer.from(value, 'base64').toString('utf8');
  const identity = await ensureServerCertificate({ directory, deviceId: 'server-encrypted-test', encryptPrivateKey, decryptPrivateKey });
  assert.equal(typeof identity.key, 'string');
  assert.match(identity.key, /BEGIN PRIVATE KEY/);
  assert.equal(new crypto.X509Certificate(identity.cert).publicKey.asymmetricKeyType, 'ec');
  assert.equal(fs.readFileSync(path.join(directory, 'sifer360-lan-identity-v1.json'), 'utf8').includes('"key"'), false);
  assert.equal(fs.readFileSync(path.join(directory, 'sifer360-lan-identity-v1.json'), 'utf8').includes('"keyEncrypted"'), true);
});
