const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');
const deadlineScheduler = require('../src/services/deadlineScheduler');
const emailService = require('../src/services/emailService');

const DAY_MS = 24 * 60 * 60 * 1000;
const soon = () => new Date(Date.now() + DAY_MS / 2).toISOString();

function makeUser(email) {
  const user = db.createUser({ email, full_name: email, password_hash: 'hash' });
  return { ...user, token: generateJWT({ userId: user.user_id, email, name: email }) };
}

function makeTask(workspaceId, ownerId, assigneeId, overrides = {}) {
  return db.createTask({
    workspace_id: workspaceId,
    title: 'Due soon',
    status: 'In-Progress',
    due_date: soon(),
    created_by: ownerId,
    assignees: [assigneeId],
    ...overrides
  });
}

function deadlineAlerts(userId) {
  return db.getNotificationsForUser(userId).filter(n => n.type === 'DEADLINE');
}

function post(server, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      port: server.address().port,
      path: '/api/v1/notifications/trigger-deadline-alerts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${token}`
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('REQ-8.2: deadline scheduler', async t => {
  let owner, assignee, workspace;

  t.beforeEach(() => {
    db.reset();
    owner = makeUser('owner@example.com');
    assignee = makeUser('assignee@example.com');
    workspace = db.createWorkspace({ title: 'Deadlines', owner_id: owner.user_id });
  });

  t.afterEach(() => {
    deadlineScheduler.stop();
    emailService.setTransport();
  });

  await t.test('emails each alert once through the replaceable sender', async () => {
    const sent = [];
    emailService.setTransport(message => { sent.push(message); });
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id, { title: 'Email me' });

    deadlineScheduler.runCheck();
    deadlineScheduler.runCheck();
    await new Promise(setImmediate);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, assignee.email);
    assert.match(sent[0].text, /Email me/);
  });

  await t.test('a failing sender does not stop in-app notifications', async t2 => {
    const logged = t2.mock.method(console, 'error', () => {});
    emailService.setTransport(() => { throw new Error('SMTP down'); });
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id);

    assert.equal(deadlineScheduler.runCheck().length, 1);
    await new Promise(setImmediate);

    assert.equal(deadlineAlerts(assignee.user_id).length, 1);
    assert.equal(logged.mock.callCount(), 1);
  });

  await t.test('alerts only for open tasks due within 24 hours', () => {
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id);
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id, { status: 'Done' });
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id, {
      due_date: new Date(Date.now() + 3 * DAY_MS).toISOString()
    });

    assert.equal(deadlineScheduler.runCheck().length, 1);
  });

  await t.test('does not repeat an alert within 24 hours, then alerts again', () => {
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id);

    assert.equal(deadlineScheduler.runCheck().length, 1);
    assert.equal(deadlineScheduler.runCheck().length, 0);
    assert.equal(deadlineScheduler.runCheck({ now: new Date(Date.now() + DAY_MS + 1000) }).length, 1);
  });

  await t.test('start runs a check immediately and then on the interval', async () => {
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id);
    deadlineScheduler.start(5);
    assert.equal(deadlineAlerts(assignee.user_id).length, 1);

    deadlineScheduler.stop();
    db.reset();
    assignee = makeUser('later@example.com');
    workspace = db.createWorkspace({ title: 'Later', owner_id: owner.user_id });
    deadlineScheduler.start(5);
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id);
    assert.equal(deadlineAlerts(assignee.user_id).length, 0);

    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(deadlineAlerts(assignee.user_id).length, 1);
  });

  await t.test('trigger endpoint is limited to Admins of one workspace', async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const otherOwner = makeUser('other-owner@example.com');
    const otherWorkspace = db.createWorkspace({ title: 'Other', owner_id: otherOwner.user_id });
    makeTask(workspace.workspace_id, owner.user_id, assignee.user_id, { title: 'Mine' });
    makeTask(otherWorkspace.workspace_id, otherOwner.user_id, otherOwner.user_id, { title: 'Private' });

    assert.equal((await post(server, owner.token, {})).statusCode, 400);
    assert.equal((await post(server, owner.token, { workspace_id: 'missing' })).statusCode, 404);
    assert.equal((await post(server, assignee.token, { workspace_id: workspace.workspace_id })).statusCode, 403);
    assert.equal((await post(server, owner.token, { workspace_id: otherWorkspace.workspace_id })).statusCode, 403);
    assert.equal(deadlineAlerts(otherOwner.user_id).length, 0);

    const allowed = await post(server, owner.token, { workspace_id: workspace.workspace_id });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.data.dispatched_count, 1);
    assert.ok(!JSON.stringify(allowed.data).includes('Private'));
    assert.equal(deadlineAlerts(otherOwner.user_id).length, 0);
  });
});
