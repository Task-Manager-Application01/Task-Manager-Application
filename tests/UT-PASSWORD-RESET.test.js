const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const emailService = require('../src/services/emailService');
const { hashPassword } = require('../src/middleware/authMiddleware');
const { startServer, stopServer, api, flush } = require('./helpers/http');

const RESET_REQUEST = '/api/v1/auth/password-reset/request';
const RESET_CONFIRM = '/api/v1/auth/password-reset/confirm';
const TOKEN_PATTERN = /\b[0-9a-f]{64}\b/;

test('UT-PWRESET: password recovery by email (REQ-1.3)', async (t) => {
  const server = await startServer();
  let sent = [];

  t.beforeEach(() => {
    db.reset();
    sent = [];
    emailService.setTransport(message => { sent.push(message); });
    db.createUser({
      full_name: 'Reset User',
      email: 'reset@pes.edu',
      password_hash: hashPassword('OldPassword@1')
    });
  });

  t.after(async () => {
    emailService.setTransport();
    await stopServer(server);
  });

  async function requestReset(email) {
    const res = await api(server, 'POST', RESET_REQUEST, { body: { email } });
    await flush();
    return res;
  }

  await t.test('the response never contains the reset token', async () => {
    const res = await requestReset('reset@pes.edu');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal('resetToken' in res.body, false);

    assert.equal(sent.length, 1);
    const token = TOKEN_PATTERN.exec(sent[0].text)[0];
    assert.ok(!JSON.stringify(res.body).includes(token));
  });

  await t.test('the token is delivered through the email sender', async () => {
    await requestReset('reset@pes.edu');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'reset@pes.edu');
    assert.ok(sent[0].subject);
    assert.match(sent[0].text, TOKEN_PATTERN);
    assert.match(sent[0].text, /15 minutes/);

    // The emailed token really resets the password.
    const token = TOKEN_PATTERN.exec(sent[0].text)[0];
    const confirm = await api(server, 'POST', RESET_CONFIRM, {
      body: { token, new_password: 'NewPassword@2' }
    });
    assert.equal(confirm.status, 200);

    const login = await api(server, 'POST', '/api/v1/auth/login', {
      body: { email: 'reset@pes.edu', password: 'NewPassword@2' }
    });
    assert.equal(login.status, 200);
  });

  await t.test('registered and unregistered emails get the same response', async () => {
    const known = await requestReset('reset@pes.edu');
    const unknown = await requestReset('nobody@pes.edu');

    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(sent.length, 1, 'only the registered address receives an email');
    assert.equal(sent[0].to, 'reset@pes.edu');
  });

  await t.test('an address that exists only as a pending invitation gets no token', async () => {
    db.createUser({ full_name: 'Pending', email: 'pending@pes.edu', password_hash: 'PENDING_INVITATION' });

    const res = await requestReset('pending@pes.edu');
    const known = await requestReset('reset@pes.edu');

    assert.deepEqual(res.body, known.body);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'reset@pes.edu');
  });

  await t.test('a malformed email is rejected without sending anything', async () => {
    const res = await requestReset('not-an-email');
    assert.equal(res.status, 400);
    assert.equal(sent.length, 0);
  });

  await t.test('a failing email sender does not change the response or leak the token', async () => {
    emailService.setTransport(() => { throw new Error('smtp down'); });
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = await requestReset('reset@pes.edu');
      assert.equal(res.status, 200);
      assert.equal('resetToken' in res.body, false);
    } finally {
      console.error = originalError;
    }
  });

  await t.test('the token is valid for 15 minutes and not after', async (tt) => {
    await requestReset('reset@pes.edu');
    const token = TOKEN_PATTERN.exec(sent[0].text)[0];
    const issuedAt = Date.now();

    assert.equal(db.PASSWORD_RESET_TTL_MS, 15 * 60 * 1000);
    const entry = db.passwordResets.get(token);
    const lifetime = Date.parse(entry.expires_at) - issuedAt;
    assert.ok(lifetime > 14.9 * 60 * 1000 && lifetime <= 15 * 60 * 1000, `lifetime was ${lifetime} ms`);

    const clock = tt.mock.method(Date, 'now');

    clock.mock.mockImplementation(() => issuedAt + 14 * 60 * 1000 + 59 * 1000);
    assert.equal(db.verifyPasswordResetToken(token), 'reset@pes.edu', 'still valid just before 15 minutes');

    clock.mock.mockImplementation(() => issuedAt + 15 * 60 * 1000 + 1000);
    const late = await api(server, 'POST', RESET_CONFIRM, {
      body: { token, new_password: 'NewPassword@2' }
    });
    assert.equal(late.status, 400);

    clock.mock.restore();
    const login = await api(server, 'POST', '/api/v1/auth/login', {
      body: { email: 'reset@pes.edu', password: 'OldPassword@1' }
    });
    assert.equal(login.status, 200, 'the password was not changed by the expired token');
  });

  await t.test('a token works only once', async () => {
    await requestReset('reset@pes.edu');
    const token = TOKEN_PATTERN.exec(sent[0].text)[0];

    const first = await api(server, 'POST', RESET_CONFIRM, { body: { token, new_password: 'NewPassword@2' } });
    const second = await api(server, 'POST', RESET_CONFIRM, { body: { token, new_password: 'Another@Pass3' } });

    assert.equal(first.status, 200);
    assert.equal(second.status, 400);
  });

  await t.test('requesting again invalidates the earlier token', async () => {
    await requestReset('reset@pes.edu');
    await requestReset('reset@pes.edu');
    assert.equal(sent.length, 2);
    const [older, newer] = sent.map(m => TOKEN_PATTERN.exec(m.text)[0]);
    assert.notEqual(older, newer);

    const withOlder = await api(server, 'POST', RESET_CONFIRM, { body: { token: older, new_password: 'NewPassword@2' } });
    assert.equal(withOlder.status, 400);

    const withNewer = await api(server, 'POST', RESET_CONFIRM, { body: { token: newer, new_password: 'NewPassword@2' } });
    assert.equal(withNewer.status, 200);
  });
});
