const net = require('node:net');

function isLanAddress(address) {
  let host = String(address || '').trim().toLowerCase();
  if (!host) return false;
  const zoneIndex = host.indexOf('%');
  if (zoneIndex >= 0) host = host.slice(0, zoneIndex);

  if (host.startsWith('::ffff:')) {
    const mapped = host.slice(7);
    if (net.isIP(mapped) === 4) return isLanAddress(mapped);
  }

  const family = net.isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);
  }
  if (family === 6) {
    if (host === '::1') return true;
    const first = parseInt(host.split(':')[0] || '0', 16);
    return (first >= 0xfc00 && first <= 0xfdff) ||
      (first >= 0xfe80 && first <= 0xfebf);
  }
  return false;
}

function assertLanHost(host) {
  if (!isLanAddress(host)) throw new Error('La dirección del servidor debe ser una IP privada de la red local. No se enviaron credenciales.');
  return true;
}

module.exports = { isLanAddress, assertLanHost };
