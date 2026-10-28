const crypto = require('crypto');

/**
 * Authentication Middleware & JWT Utility
 * Conforms to Section 2.5: Stateless JWT signed with HMAC-SHA256 with 24-hour expiration.
 * Owner: Chetana V Iyer (PES1UG24CS130) | ARC-AUTH | DSN-01
 */

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function generateJWT(payload, expiresInSeconds = 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJWT(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  let header;
  let payload;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const actualSignature = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    actualSignature.length !== expected.length ||
    !crypto.timingSafeEqual(actualSignature, expected)
  ) {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

/**
 * REQ-NFR-4 (Credential Protection):
 * Salted hashing with high-cost iterations (work factor >= 10).
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(':')) return false;
  const [salt, originalHash] = storedPasswordHash.split(':');
  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  const actual = Buffer.from(testHash);
  const expected = Buffer.from(originalHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Express-compatible auth middleware protecting private endpoints
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers ? (req.headers['authorization'] || req.headers['Authorization']) : null;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Access denied. Missing Bearer JWT token.'
    });
  }

  const decoded = verifyJWT(token);
  if (!decoded) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Invalid or expired JWT token.'
    });
  }

  req.user = decoded;
  if (next) next();
  return true;
}

module.exports = {
  generateJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
  authenticateToken
};
