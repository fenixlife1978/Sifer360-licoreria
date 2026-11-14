const crypto = require('node:crypto');

function hasValidBearerToken(header, expectedToken) {
  if (typeof header !== 'string' || typeof expectedToken !== 'string' || !expectedToken) return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(supplied, expected);
}

module.exports = { hasValidBearerToken };
