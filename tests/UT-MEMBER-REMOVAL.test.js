const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const realtimeService = require('../src/services/realtimeService');
const { startServer, stopServer, bearer, api } = require('./helpers/http');

test('UT-MEMBER-REMOVAL: removing workspace members (REQ-2.3)', async (t) => {
  const server = await startServer();
  let admin, member, viewer, outsider, ws;

  t.beforeEach(() => {
    db.reset();
    const make = (name) => db.createUser({ full_name: name, email: `${name}@pes.edu`, password_hash: 'x' });
    admin = make('admin');
    member = make('member');
    viewer = make('viewer');
    outsider = make('outsider');
    ws = db.createWorkspace({ title: 'Team 4', owner_id: admin.user_id });
    db.addMembership({ workspace_id: ws.workspace_id, user_id: member.user_id, role: 'Member' });
    db.addMembership({ workspace_id: ws.workspace_id, user_id: viewer.user_id, role: 'Viewer' });
  });

  t.after(() => stopServer(server));

  const remove = (target, as, workspaceId = ws.workspace_id) =>
    api(server, 'DELETE', `/api/v1/workspaces/${workspaceId}/members/${target.user_id ?? target}`, {
      headers: as ? bearer(as) : undefined
    });
  const isMember = (user) => Boolean(db.getMembership(ws.workspace_id, user.user_id));

  await t.test('an Admin can remove a member', async () => {
    const res = await remove(member, admin);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(isMember(member), false);

    const list = await api(server, 'GET', `/api/v1/workspaces/${ws.workspace_id}/members`, { headers: bearer(admin) });
    assert.deepEqual(list.body.data.map(m => m.user_id).sort(), [admin.user_id, viewer.user_id].sort());
  });

  await t.test('Members, Viewers and outsiders get 403 and nothing changes', async () => {
    for (const actor of [member, viewer, outsider]) {
      const res = await remove(viewer, actor);
      assert.equal(res.status, 403);
    }
    assert.equal(isMember(viewer), true);
    assert.equal(isMember(member), true);
  });

  await t.test('a request without a token gets 401', async () => {
    assert.equal((await remove(member, null)).status, 401);
    assert.equal(isMember(member), true);
  });

  await t.test('unknown member and unknown workspace give 404', async () => {
    assert.equal((await remove(outsider, admin)).status, 404);
    assert.equal((await remove('00000000-0000-0000-0000-000000000000', admin)).status, 404);
    assert.equal((await remove(member, admin, 'missing-workspace')).status, 404);
  });

  await t.test('a workspace cannot lose its last Admin', async () => {
    const self = await remove(admin, admin);
    assert.equal(self.status, 409);
    assert.equal(isMember(admin), true);
    assert.equal(db.countWorkspaceAdmins(ws.workspace_id), 1);
  });

  await t.test('with a second Admin, an Admin can be removed, but never the last one', async () => {
    const second = db.createUser({ full_name: 'second', email: 'second@pes.edu', password_hash: 'x' });
    db.addMembership({ workspace_id: ws.workspace_id, user_id: second.user_id, role: 'Admin' });

    assert.equal((await remove(admin, second)).status, 200);
    assert.equal(db.countWorkspaceAdmins(ws.workspace_id), 1);

    assert.equal((await remove(second, second)).status, 409);
    assert.equal(isMember(second), true);
  });

  await t.test('a removed member immediately loses access', async () => {
    const task = db.createTask({
      workspace_id: ws.workspace_id,
      title: 'Shared task',
      priority: 'Low',
      created_by: admin.user_id
    });
    const urls = [
      `/api/v1/workspaces/${ws.workspace_id}/members`,
      `/api/v1/workspaces/${ws.workspace_id}/kanban`,
      `/api/v1/tasks?workspace_id=${ws.workspace_id}`,
      `/api/v1/tasks/${task.task_id}`
    ];

    for (const url of urls) {
      assert.equal((await api(server, 'GET', url, { headers: bearer(member) })).status, 200, url);
    }

    assert.equal((await remove(member, admin)).status, 200);

    // The same token keeps working for sign-in, but every workspace route now refuses it.
    for (const url of urls) {
      assert.equal((await api(server, 'GET', url, { headers: bearer(member) })).status, 403, url);
    }
    const write = await api(server, 'POST', '/api/v1/tasks', {
      headers: bearer(member),
      body: { workspace_id: ws.workspace_id, title: 'Sneaky', priority: 'Low' }
    });
    assert.equal(write.status, 403);
  });

  await t.test('a removed member is taken off task assignments', async () => {
    const task = db.createTask({
      workspace_id: ws.workspace_id,
      title: 'Assigned task',
      priority: 'Low',
      created_by: admin.user_id,
      assignees: [member.user_id, admin.user_id]
    });

    const res = await remove(member, admin);
    assert.equal(res.body.data.tasks_unassigned, 1);
    assert.deepEqual(db.getTask(task.task_id).assignees, [admin.user_id]);
  });

  await t.test('a removed member’s live event stream is closed', async () => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/workspaces/${ws.workspace_id}/events`,
      { headers: bearer(member) }
    );
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    assert.equal(realtimeService.subscriberCount(ws.workspace_id), 1);

    assert.equal((await remove(member, admin)).status, 200);

    let ended = false;
    for (let i = 0; i < 50 && !ended; i++) {
      const { done } = await Promise.race([
        reader.read(),
        new Promise(resolve => setTimeout(() => resolve({ done: false }), 100))
      ]);
      ended = done;
    }
    assert.equal(ended, true, 'the stream should end after removal');
    assert.equal(realtimeService.subscriberCount(ws.workspace_id), 0);
  });

  await t.test('the removal appears in the audit log', async () => {
    await remove(member, admin);

    const logs = await api(server, 'GET', `/api/v1/workspaces/${ws.workspace_id}/audit-logs`, { headers: bearer(admin) });
    const entry = logs.body.data.find(l => l.action === 'MEMBER_REMOVED');

    assert.ok(entry, 'MEMBER_REMOVED should be logged');
    assert.equal(entry.actor_id, admin.user_id);
    assert.equal(entry.details.user_id, member.user_id);
    assert.equal(entry.details.role, 'Member');
  });

  await t.test('a failed removal is not logged', async () => {
    await remove(viewer, member);
    await remove(admin, admin);
    assert.equal(db.getAuditLogs(ws.workspace_id).filter(l => l.action === 'MEMBER_REMOVED').length, 0);
  });
});
