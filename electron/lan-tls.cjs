const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const selfsigned = require('selfsigned');

function normalizeFingerprint(value) {
  return String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
}

function verifyFingerprint(actual, expected) {
  const a = normalizeFingerprint(actual);
  const e = normalizeFingerprint(expected);
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(e)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(e, 'hex'));
}

async function ensureServerCertificate({ directory, deviceId }) {
  if (!directory || !deviceId) throw new Error('Falta la ubicación o identidad del servidor LAN.');
  const file = path.join(directory, 'sifer360-lan-identity-v1.json');
  let identity;
  if (fs.existsSync(file)) {
    try { identity = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error('La identidad TLS del servidor está dañada. Se conserva sin reemplazar. ' + (error.message || String(error))); }
  } else {
    const notBeforeDate = new Date(Date.now() - 5 * 60 * 1000);
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 5);
    const generated = await selfsigned.generate(
      [{ name: 'commonName', value: 'SIFER360-LAN-' + String(deviceId) }],
      {
        keyType: 'ec',
        curve: 'P-256',
        algorithm: 'sha256',
        notBeforeDate,
        notAfterDate,
        extensions: [
          { name: 'basicConstraints', cA: false, critical: true },
          { name: 'keyUsage', digitalSignature: true, keyAgreement: true, critical: true },
          { name: 'extKeyUsage', serverAuth: true }
        ]
      }
    );
    identity = { version: 1, deviceId: String(deviceId), key: generated.private, cert: generated.cert };
    const temporary = file + '.tmp';
    let fd;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fd = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(fd, JSON.stringify(identity), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } catch (error) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      throw new Error('No se pudo guardar de forma durable la identidad TLS del servidor. ' + (error.message || String(error)));
    }
  }
  if (!identity || identity.version !== 1 || identity.deviceId !== String(deviceId) ||
      typeof identity.key !== 'string' || typeof identity.cert !== 'string') {
    throw new Error('La identidad TLS no coincide con este servidor. No se generará otra automáticamente.');
  }
  const certificate = new crypto.X509Certificate(identity.cert);
  const privateKey = crypto.createPrivateKey(identity.key);
  const privatePublic = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const certificatePublic = certificate.publicKey.export({ type: 'spki', format: 'der' });
  if (!crypto.timingSafeEqual(privatePublic, certificatePublic)) throw new Error('La clave privada no corresponde al certificado TLS guardado.');
  return { key: identity.key, cert: identity.cert, fingerprint: certificate.fingerprint256 };
}

function createPinnedAgent(certificatePem, expectedFingerprint) {
  const certificate = new crypto.X509Certificate(certificatePem);
  if (!verifyFingerprint(certificate.fingerprint256, expectedFingerprint)) {
    throw new Error('La huella configurada no coincide con el certificado guardado.');
  }
  return new https.Agent({
    ca: certificatePem,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, peerCertificate) => {
      if (!verifyFingerprint(peerCertificate.fingerprint256, expectedFingerprint)) {
        return new Error('La identidad TLS del servidor LAN no coincide. Conexión bloqueada.');
      }
      return undefined;
    }
  });
}

function retrievePeerCertificate(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: host,
      port,
      path: '/api/health',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, response => {
      const peer = response.socket.getPeerCertificate(true);
      const raw = peer && peer.raw;
      response.resume();
      response.on('end', () => {
        if (!raw) return reject(new Error('El servidor no presentó un certificado TLS.'));
        try {
          const certificate = new crypto.X509Certificate(raw);
          resolve({ certificate: certificate.toString(), fingerprint: certificate.fingerprint256 });
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Tiempo agotado al verificar la identidad TLS del servidor.')));
    request.on('error', reject);
  });
}

module.exports = { normalizeFingerprint, verifyFingerprint, ensureServerCertificate, createPinnedAgent, retrievePeerCertificate };
