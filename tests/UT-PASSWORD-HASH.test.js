const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { db } = require('../src/models/Database');
const authController = require('../src/controllers/authController');
const {
  hashPassword,
  verifyPassword,
  needsRehash,
  PBKDF2_ITERATIONS
} = require('../src/middleware/authMiddleware');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }
  };
}

// The format written before this change: "<salt>:<hash>", PBKDF2-SHA512, 10,000 iterations.
function legacyHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

test('UT-PWHASH: password hashing and verification (REQ-1.2, REQ-NFR-4)', async (t) => {
  t.beforeEach(() => db.reset());

  await t.test('hash is salted, versioned and never contains the plaintext', () => {
    const password = 'Password@123';
    const a = hashPassword(password);
    const b = hashPassword(password);

    assert.notEqual(a, b, 'two hashes of the same password must use different salts');
    assert.ok(!a.includes(password));

    const [scheme, iterations, salt, hash] = a.split('$');
    assert.equal(scheme, 'pbkdf2-sha512');
    assert.equal(Number(iterations), PBKDF2_ITERATIONS);
    assert.equal(salt.length, 32);
    assert.equal(hash.length, 128);
  });

  await t.test('work factor is at least 10, as the STP case requires', () => {
    const iterations = Number(hashPassword('Password@123').split('$')[1]);
    assert.ok(iterations >= 10);
    assert.ok(iterations >= 210000, 'must meet the OWASP minimum for PBKDF2-HMAC-SHA512');
  });

  await t.test('verifyPassword accepts the right password and rejects others', () => {
    const stored = hashPassword('Password@123');
    assert.equal(verifyPassword('Password@123', stored), true);
    assert.equal(verifyPassword('password@123', stored), false);
    assert.equal(verifyPassword('', stored), false);
    assert.equal(verifyPassword(undefined, stored), false);
    assert.equal(verifyPassword(12345, stored), false);
  });

  await t.test('verifyPassword rejects malformed, tampered and placeholder hashes', () => {
    const stored = hashPassword('Password@123');
    const tampered = stored.slice(0, -1) + (stored.endsWith('0') ? '1' : '0');

    assert.equal(verifyPassword('Password@123', tampered), false);
    assert.equal(verifyPassword('Password@123', 'pbkdf2-sha512$abc$salt$hash'), false);
    assert.equal(verifyPassword('Password@123', 'pbkdf2-sha512$999999999$salt$hash'), false);
    assert.equal(verifyPassword('Password@123', 'PENDING_INVITATION'), false);
    assert.equal(verifyPassword('Password@123', null), false);
    assert.equal(verifyPassword('Password@123', ''), false);
  });

  await t.test('hashPassword refuses empty or non-string input', () => {
    assert.throws(() => hashPassword(''), TypeError);
    assert.throws(() => hashPassword(undefined), TypeError);
  });

  await t.test('hashes from the previous version still verify and are flagged for upgrade', () => {
    const old = legacyHash('Password@123');
    assert.equal(verifyPassword('Password@123', old), true);
    assert.equal(verifyPassword('Wrong@123', old), false);
    assert.equal(needsRehash(old), true);
    assert.equal(needsRehash(hashPassword('Password@123')), false);
    assert.equal(needsRehash('PENDING_INVITATION'), false);
  });

  await t.test('registration stores the new hash format', async () => {
    const res = mockRes();
    await authController.register({
      body: { full_name: 'Hash User', email: 'hash@pes.edu', password: 'Password@123' }
    }, res);

    assert.equal(res.statusCode, 201);
    const stored = db.findUserByEmail('hash@pes.edu').password_hash;
    assert.match(stored, /^pbkdf2-sha512\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  await t.test('login works and upgrades a legacy hash in place', async () => {
    const user = db.createUser({
      full_name: 'Legacy User',
      email: 'legacy@pes.edu',
      password_hash: legacyHash('Password@123')
    });

    const bad = mockRes();
    await authController.login({ body: { email: 'legacy@pes.edu', password: 'Wrong@123' } }, bad);
    assert.equal(bad.statusCode, 401);
    assert.equal(needsRehash(db.getUser(user.user_id).password_hash), true, 'failed login must not rehash');

    const good = mockRes();
    await authController.login({ body: { email: 'legacy@pes.edu', password: 'Password@123' } }, good);
    assert.equal(good.statusCode, 200);

    const upgraded = db.getUser(user.user_id).password_hash;
    assert.equal(needsRehash(upgraded), false);
    assert.equal(verifyPassword('Password@123', upgraded), true);

    const again = mockRes();
    await authController.login({ body: { email: 'legacy@pes.edu', password: 'Password@123' } }, again);
    assert.equal(again.statusCode, 200);
  });

  await t.test('password reset stores the new hash format and the new password logs in', async () => {
    db.createUser({
      full_name: 'Reset User',
      email: 'reset@pes.edu',
      password_hash: legacyHash('OldPassword@1')
    });
    const token = db.createPasswordResetToken('reset@pes.edu');

    const res = mockRes();
    await authController.resetPassword({ body: { token, new_password: 'NewPassword@2' } }, res);
    assert.equal(res.statusCode, 200);

    const stored = db.findUserByEmail('reset@pes.edu').password_hash;
    assert.equal(needsRehash(stored), false);

    const oldLogin = mockRes();
    await authController.login({ body: { email: 'reset@pes.edu', password: 'OldPassword@1' } }, oldLogin);
    assert.equal(oldLogin.statusCode, 401);

    const newLogin = mockRes();
    await authController.login({ body: { email: 'reset@pes.edu', password: 'NewPassword@2' } }, newLogin);
    assert.equal(newLogin.statusCode, 200);
  });
});
