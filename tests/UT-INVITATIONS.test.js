const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const emailService = require('../src/services/emailService');
const { hashPassword, verifyJWT } = require('../src/middleware/authMiddleware');
const { startServer, stopServer, bearer, api, flush } = require('./helpers/http');

const TOKEN_PATTERN = /\b[0-9a-f]{64}\b/;
const ACCEPT = '/api/v1/invitations/accept';

test('UT-INVITE: email invitations (REQ-2.2)', async (t) => {
  const server = await startServer();
  let sent;
  let admin;
  let ws;

  t.beforeEach(() => {
    db.reset();
    sent = [];
    emailService.setTransport(message => { sent.push(message); });
    admin = db.createUser({ full_name: 'Admin', email: 'admin@pes.edu', password_hash: hashPassword('AdminPass@1') });
    ws = db.createWorkspace({ title: 'Team 4', owner_id: admin.user_id });
  });

  t.after(async () => {
    emailService.setTransport();
    await stopServer(server);
  });

  async function invite(email, role = 'Member', as = admin, workspaceId = ws.workspace_id) {
    const res = await api(server, 'POST', `/api/v1/workspaces/${workspaceId}/invite`, {
      body: { email, role },
      headers: bearer(as)
    });
    await flush();
    return res;
  }

  const lastToken = () => TOKEN_PATTERN.exec(sent[sent.length - 1].text)[0];
  const newAccount = { full_name: 'New Invitee', password: 'InviteePass@1' };

  await t.test('inviting sends an email and creates a pending invitation', async () => {
    const res = await invite('new@pes.edu', 'Viewer');

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'Pending');
    assert.equal(res.body.data.role, 'Viewer');
    assert.equal('token' in res.body.data, false);
    assert.equal('token_hash' in res.body.data, false);
    assert.ok(!JSON.stringify(res.body).includes(lastToken()));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'new@pes.edu');
    assert.match(sent[0].text, /Team 4/);

    const audit = db.getAuditLogs(ws.workspace_id).find(l => l.action === 'MEMBER_INVITED');
    assert.ok(audit);
  });

  await t.test('only a hash of the token is stored', async () => {
    await invite('new@pes.edu');
    const token = lastToken();
    assert.ok(!JSON.stringify([...db.invitations.values()]).includes(token));
  });

  await t.test('no account and no access is created until the invitation is accepted', async () => {
    await invite('new@pes.edu');
    assert.equal(db.findUserByEmail('new@pes.edu'), null);
    assert.equal(db.listWorkspaceMembers(ws.workspace_id).length, 1);
  });

  await t.test('only Admins can invite; Members and Viewers get 403, outsiders 403', async () => {
    const member = db.createUser({ full_name: 'M', email: 'm@pes.edu', password_hash: 'x' });
    const viewer = db.createUser({ full_name: 'V', email: 'v@pes.edu', password_hash: 'x' });
    const outsider = db.createUser({ full_name: 'O', email: 'o@pes.edu', password_hash: 'x' });
    db.addMembership({ workspace_id: ws.workspace_id, user_id: member.user_id, role: 'Member' });
    db.addMembership({ workspace_id: ws.workspace_id, user_id: viewer.user_id, role: 'Viewer' });

    for (const actor of [member, viewer, outsider]) {
      assert.equal((await invite('new@pes.edu', 'Member', actor)).status, 403);
    }
    assert.equal(sent.length, 0);
  });

  await t.test('invalid role, invalid email and already-a-member are rejected', async () => {
    assert.equal((await invite('new@pes.edu', 'Owner')).status, 400);
    assert.equal((await invite('nope')).status, 400);
    assert.equal((await invite('admin@pes.edu')).status, 409);
    assert.equal(sent.length, 0);
  });

  await t.test('a new invitee sets up an account they can log in to and joins with the invited role', async () => {
    await invite('new@pes.edu', 'Member');
    const res = await api(server, 'POST', ACCEPT, { body: { token: lastToken(), ...newAccount } });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.role, 'Member');
    assert.equal(verifyJWT(res.body.data.token).email, 'new@pes.edu');

    const login = await api(server, 'POST', '/api/v1/auth/login', {
      body: { email: 'new@pes.edu', password: newAccount.password }
    });
    assert.equal(login.status, 200);

    const members = await api(server, 'GET', `/api/v1/workspaces/${ws.workspace_id}/members`, {
      headers: { Authorization: `Bearer ${login.body.data.token}` }
    });
    assert.equal(members.status, 200);
    assert.equal(members.body.count, 2);

    const joined = db.getAuditLogs(ws.workspace_id).find(l => l.action === 'MEMBER_JOINED');
    assert.ok(joined);
  });

  await t.test('workspace access starts only after acceptance', async () => {
    const existing = db.createUser({ full_name: 'Ex', email: 'ex@pes.edu', password_hash: hashPassword('ExistingPass@1') });
    await invite('ex@pes.edu', 'Member');

    const before = await api(server, 'GET', `/api/v1/workspaces/${ws.workspace_id}/members`, { headers: bearer(existing) });
    assert.equal(before.status, 403);

    const accept = await api(server, 'POST', ACCEPT, { body: { token: lastToken() }, headers: bearer(existing) });
    assert.equal(accept.status, 200);
    assert.equal('token' in accept.body.data, false, 'existing accounts do not get a new login token');

    const after = await api(server, 'GET', `/api/v1/workspaces/${ws.workspace_id}/members`, { headers: bearer(existing) });
    assert.equal(after.status, 200);
  });

  await t.test('an existing account must be signed in as the invited user', async () => {
    const existing = db.createUser({ full_name: 'Ex', email: 'ex@pes.edu', password_hash: hashPassword('ExistingPass@1') });
    const other = db.createUser({ full_name: 'Other', email: 'other@pes.edu', password_hash: hashPassword('OtherPass@1') });
    await invite('ex@pes.edu');
    const token = lastToken();

    assert.equal((await api(server, 'POST', ACCEPT, { body: { token } })).status, 401);
    assert.equal((await api(server, 'POST', ACCEPT, { body: { token }, headers: bearer(other) })).status, 403);
    assert.equal(db.getMembership(ws.workspace_id, existing.user_id), null);

    assert.equal((await api(server, 'POST', ACCEPT, { body: { token }, headers: bearer(existing) })).status, 200);
  });

  await t.test('a token cannot be reused', async () => {
    await invite('new@pes.edu');
    const token = lastToken();

    assert.equal((await api(server, 'POST', ACCEPT, { body: { token, ...newAccount } })).status, 200);
    const again = await api(server, 'POST', ACCEPT, { body: { token, full_name: 'Intruder', password: 'Intruder@Pass1' } });
    assert.equal(again.status, 400);
    assert.equal(db.listWorkspaceMembers(ws.workspace_id).length, 2);
  });

  await t.test('an expired invitation is refused', async (tt) => {
    await invite('new@pes.edu');
    const token = lastToken();
    const issuedAt = Date.now();

    assert.equal(db.INVITATION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
    const clock = tt.mock.method(Date, 'now');
    clock.mock.mockImplementation(() => issuedAt + db.INVITATION_TTL_MS + 1000);

    const res = await api(server, 'POST', ACCEPT, { body: { token, ...newAccount } });
    assert.equal(res.status, 400);
    clock.mock.restore();
    assert.equal(db.findUserByEmail('new@pes.edu'), null);
  });

  await t.test('an invitation is still valid just before it expires', async (tt) => {
    await invite('new@pes.edu');
    const token = lastToken();
    const issuedAt = Date.now();
    const clock = tt.mock.method(Date, 'now');
    clock.mock.mockImplementation(() => issuedAt + db.INVITATION_TTL_MS - 60 * 1000);

    const res = await api(server, 'POST', ACCEPT, { body: { token, ...newAccount } });
    assert.equal(res.status, 200);
    clock.mock.restore();
  });

  await t.test('unknown tokens and a re-invite that revokes the old link are refused', async () => {
    assert.equal((await api(server, 'POST', ACCEPT, { body: { token: 'f'.repeat(64), ...newAccount } })).status, 400);
    assert.equal((await api(server, 'POST', ACCEPT, { body: {} })).status, 400);

    await invite('new@pes.edu');
    const older = lastToken();
    await invite('new@pes.edu', 'Viewer');
    const newer = lastToken();

    assert.equal((await api(server, 'POST', ACCEPT, { body: { token: older, ...newAccount } })).status, 400);
    const ok = await api(server, 'POST', ACCEPT, { body: { token: newer, ...newAccount } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.role, 'Viewer');
  });

  await t.test('a new invitee must supply a name and a password that meets the rules', async () => {
    await invite('new@pes.edu');
    const token = lastToken();

    assert.equal((await api(server, 'POST', ACCEPT, { body: { token } })).status, 400);
    assert.equal((await api(server, 'POST', ACCEPT, { body: { token, full_name: 'N', password: 'weak' } })).status, 400);
    assert.equal(db.findUserByEmail('new@pes.edu'), null);

    // The failed attempts did not use up the invitation.
    assert.equal((await api(server, 'POST', ACCEPT, { body: { token, ...newAccount } })).status, 200);
  });

  await t.test('a legacy pending-invitation stub can be activated by accepting', async () => {
    const stub = db.createUser({ full_name: 'stub', email: 'stub@pes.edu', password_hash: 'PENDING_INVITATION' });
    await invite('stub@pes.edu');

    const res = await api(server, 'POST', ACCEPT, { body: { token: lastToken(), ...newAccount } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user_id, stub.user_id);

    const login = await api(server, 'POST', '/api/v1/auth/login', {
      body: { email: 'stub@pes.edu', password: newAccount.password }
    });
    assert.equal(login.status, 200);
  });
});
