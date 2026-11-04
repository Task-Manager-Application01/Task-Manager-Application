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
 * REQ-NFR-4 / REQ-1.2 (Credential Protection):
 * Passwords are salted and hashed with PBKDF2-HMAC-SHA512 from Node's built-in crypto module.
 * The SRS names bcrypt (work factor >= 10); the team accepted PBKDF2 instead to stay
 * dependency-free (see docs/SPRINT1_DEVIATIONS.md, row 4). The iteration count follows the
 * OWASP recommendation for PBKDF2-HMAC-SHA512, which is far above bcrypt's 2^10 rounds in
 * raw hashing work.
 *
 * Stored format: pbkdf2-sha512$<iterations>$<salt hex>$<hash hex>
 * Hashes written by earlier versions ("<salt hex>:<hash hex>", 10,000 iterations) still
 * verify, and needsRehash() reports them so login can upgrade them.
 */
const PBKDF2_PREFIX = 'pbkdf2-sha512';
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha512';
const LEGACY_PBKDF2_ITERATIONS = 10000;
const MAX_ACCEPTED_ITERATIONS = 5000000;

function derivePasswordHash(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString('hex');
}

function parseStoredHash(stored) {
  if (typeof stored !== 'string') return null;

  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    const [, iterationText, salt, hash] = stored.split('$');
    const iterations = Number(iterationText);
    if (!salt || !hash || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ACCEPTED_ITERATIONS) {
      return null;
    }
    return { iterations, salt, hash, legacy: false };
  }

  // Legacy format: "<salt>:<hash>" with a fixed 10,000 iterations.
  const parts = stored.split(':');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { iterations: LEGACY_PBKDF2_ITERATIONS, salt: parts[0], hash: parts[1], legacy: true };
  }
  return null;
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedPasswordHash) {
  if (typeof password !== 'string') return false;
  const parsed = parseStoredHash(storedPasswordHash);
  if (!parsed) return false;

  const actual = Buffer.from(derivePasswordHash(password, parsed.salt, parsed.iterations));
  const expected = Buffer.from(parsed.hash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * True when a stored hash is in the legacy format or uses fewer iterations than today's setting.
 */
function needsRehash(storedPasswordHash) {
  const parsed = parseStoredHash(storedPasswordHash);
  return Boolean(parsed) && (parsed.legacy || parsed.iterations < PBKDF2_ITERATIONS);
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
  needsRehash,
  PBKDF2_ITERATIONS,
  authenticateToken
};
