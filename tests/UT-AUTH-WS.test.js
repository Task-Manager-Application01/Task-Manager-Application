const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const authController = require('../src/controllers/authController');
const workspaceController = require('../src/controllers/workspaceController');
const emailService = require('../src/services/emailService');
const { verifyJWT } = require('../src/middleware/authMiddleware');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }
  };
}

test('Feature Set A: Authentication & Workspace Governance (Chetana V Iyer - PES1UG24CS130)', async (t) => {
  t.beforeEach(() => {
    db.reset();
  });

  await t.test('UT-AUTH-01: User Registration with password complexity enforcement', async () => {
    // Valid registration
    const req = {
      body: {
        full_name: 'Chetana V Iyer',
        email: 'chetana@pes.edu',
        password: 'Password@123'
      }
    };
    const res = mockRes();
    await authController.register(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.email, 'chetana@pes.edu');
    assert.ok(res.body.data.token);

    // Rejects weak password
    const reqWeak = {
      body: {
        full_name: 'Weak User',
        email: 'weak@pes.edu',
        password: 'password' // missing uppercase, digit, special char
      }
    };
    const resWeak = mockRes();
    await authController.register(reqWeak, resWeak);
    assert.equal(resWeak.statusCode, 400);
    assert.equal(resWeak.body.success, false);
  });

  await t.test('UT-AUTH-02: JWT Authentication and Password Recovery with 15-min token', async () => {
    // Register first
    await authController.register({
      body: {
        full_name: 'Auth Test User',
        email: 'authtest@pes.edu',
        password: 'SecureAuth#2026'
      }
    }, mockRes());

    // Valid Login
    const reqLogin = {
      body: {
        email: 'authtest@pes.edu',
        password: 'SecureAuth#2026'
      }
    };
    const resLogin = mockRes();
    await authController.login(reqLogin, resLogin);

    assert.equal(resLogin.statusCode, 200);
    assert.ok(resLogin.body.data.token);
    const decoded = verifyJWT(resLogin.body.data.token);
    assert.ok(decoded);
    assert.equal(decoded.email, 'authtest@pes.edu');

    // Request Password Reset (REQ-1.3)
    // The token travels by email, never in the response.
    const sent = [];
    emailService.setTransport(message => { sent.push(message); });
    const reqReset = { body: { email: 'authtest@pes.edu' } };
    const resReset = mockRes();
    await authController.requestPasswordReset(reqReset, resReset);
    await new Promise(resolve => setImmediate(resolve));
    emailService.setTransport();
    assert.equal(resReset.statusCode, 200);
    assert.equal(resReset.body.resetToken, undefined);
    assert.equal(sent.length, 1);
    const resetToken = /\b[0-9a-f]{64}\b/.exec(sent[0].text)[0];
    assert.ok(resetToken);

    // Confirm Password Reset
    const reqConfirm = {
      body: {
        token: resetToken,
        new_password: 'UpdatedPassword$999'
      }
    };
    const resConfirm = mockRes();
    await authController.resetPassword(reqConfirm, resConfirm);
    assert.equal(resConfirm.statusCode, 200);

    // Verify login with new password
    const resNewLogin = mockRes();
    await authController.login({ body: { email: 'authtest@pes.edu', password: 'UpdatedPassword$999' } }, resNewLogin);
    assert.equal(resNewLogin.statusCode, 200);
  });

  await t.test('UT-WS-01: Workspace Creation and Automatic Admin Assignment', async () => {
    const user = db.createUser({ email: 'owner@pes.edu', full_name: 'Workspace Owner', password_hash: 'hash' });

    const req = {
      body: {
        title: 'PES University Capstone Team 4',
        description: 'Agile workspace for Task Manager application',
        owner_id: user.user_id
      }
    };
    const res = mockRes();
    await workspaceController.createWorkspace(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.title, 'PES University Capstone Team 4');

    // Verify membership role is Admin
    const membership = db.getMembership(res.body.data.workspace_id, user.user_id);
    assert.ok(membership);
    assert.equal(membership.role, 'Admin');
  });

  await t.test('UT-WS-02: Member Roles (RBAC) & Destructive Action Restrictions', async () => {
    const admin = db.createUser({ email: 'admin@pes.edu', full_name: 'Admin User', password_hash: 'hash' });
    const member = db.createUser({ email: 'member@pes.edu', full_name: 'Member User', password_hash: 'hash' });

    const ws = db.createWorkspace({
      title: 'Restricted Governance Workspace',
      owner_id: admin.user_id
    });

    // Admin invites member with role 'Member'
    const reqInvite = {
      params: { workspaceId: ws.workspace_id },
      body: { email: 'member@pes.edu', role: 'Member', actor_id: admin.user_id }
    };
    const resInvite = mockRes();
    await workspaceController.inviteMember(reqInvite, resInvite);
    assert.equal(resInvite.statusCode, 200);

    // Member attempts destructive settings update -> Should be rejected (REQ-2.3)
    const reqMemberUpdate = {
      params: { workspaceId: ws.workspace_id },
      body: { title: 'Unauthorized Rename', actor_id: member.user_id }
    };
    const resMemberUpdate = mockRes();
    await workspaceController.updateWorkspaceSettings(reqMemberUpdate, resMemberUpdate);
    assert.equal(resMemberUpdate.statusCode, 403);
    assert.ok(resMemberUpdate.body.message.includes('requires Admin role'));

    // Admin executes settings update -> Allowed
    const reqAdminUpdate = {
      params: { workspaceId: ws.workspace_id },
      body: { title: 'Authorized Renamed Workspace', actor_id: admin.user_id }
    };
    const resAdminUpdate = mockRes();
    await workspaceController.updateWorkspaceSettings(reqAdminUpdate, resAdminUpdate);
    assert.equal(resAdminUpdate.statusCode, 200);
    assert.equal(resAdminUpdate.body.data.title, 'Authorized Renamed Workspace');
  });
});
