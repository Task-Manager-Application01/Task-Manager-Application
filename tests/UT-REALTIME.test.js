const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');
const realtimeService = require('../src/services/realtimeService');

function bearer(user) {
  return { Authorization: `Bearer ${generateJWT({ userId: user.user_id, email: user.email })}` };
}

// Reads SSE frames from a fetch response, resolving each `event:`/`data:` pair.
function frameReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async function next() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(raw);
        const data = /^data: (.*)$/m.exec(raw);
        if (event) return { event: event[1], data: JSON.parse(data[1]) };
        continue; // retry hint or comment
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return predicate();
}

test('Kanban moves are broadcast in real time (SRS 4.3.1)', async (t) => {
  db.reset();
  const admin = db.createUser({ email: 'rt-admin@example.com', full_name: 'Admin', password_hash: 'h' });
  const viewer = db.createUser({ email: 'rt-viewer@example.com', full_name: 'Viewer', password_hash: 'h' });
  const outsider = db.createUser({ email: 'rt-out@example.com', full_name: 'Outsider', password_hash: 'h' });
  const ws = db.createWorkspace({ title: 'Live', owner_id: admin.user_id });
  const otherWs = db.createWorkspace({ title: 'Elsewhere', owner_id: outsider.user_id });
  db.addMembership({ workspace_id: ws.workspace_id, user_id: viewer.user_id, role: 'Viewer' });
  const task = db.createTask({ workspace_id: ws.workspace_id, title: 'Card', status: 'To-Do', priority: 'Low', created_by: admin.user_id });

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const controllers = [];
  const open = async (workspaceId, user) => {
    const controller = new AbortController();
    controllers.push(controller);
    const res = await fetch(`${base}/workspaces/${workspaceId}/events`, {
      headers: user ? bearer(user) : {},
      signal: controller.signal
    });
    return { res, controller };
  };
  const move = (user, targetColumn) =>
    fetch(`${base}/tasks/${task.task_id}/move`, {
      method: 'POST',
      headers: { ...bearer(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetColumn })
    });

  await t.test('rejects unauthenticated and non-member subscribers', async () => {
    assert.equal((await open(ws.workspace_id, null)).res.status, 401);
    assert.equal((await open(ws.workspace_id, outsider)).res.status, 403);
    assert.equal((await open('missing', admin)).res.status, 404);
    assert.equal(realtimeService.subscriberCount(ws.workspace_id), 0);
  });

  await t.test('another viewer receives a card move without reloading', async () => {
    const { res } = await open(ws.workspace_id, viewer);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const next = frameReader(res);

    assert.equal((await move(admin, 'In-Progress')).status, 200);
    const frame = await next();
    assert.equal(frame.event, 'task.moved');
    assert.equal(frame.data.task_id, task.task_id);
    assert.equal(frame.data.from, 'To-Do');
    assert.equal(frame.data.to, 'In-Progress');
    assert.equal(frame.data.actor_id, admin.user_id);
  });

  await t.test('events do not leak across workspaces', async () => {
    const { res } = await open(otherWs.workspace_id, outsider);
    const next = frameReader(res);

    assert.equal((await move(admin, 'Review')).status, 200);
    // The sentinel is the first frame the other workspace sees, so the move never reached it.
    realtimeService.publish(otherWs.workspace_id, 'sentinel', {});
    assert.equal((await next()).event, 'sentinel');
  });

  await t.test('a move to the same column broadcasts nothing', async () => {
    const { res } = await open(ws.workspace_id, admin);
    const next = frameReader(res);
    assert.equal((await move(admin, 'Review')).status, 200);
    realtimeService.publish(ws.workspace_id, 'sentinel', {});
    assert.equal((await next()).event, 'sentinel');
  });

  await t.test('disconnected clients are cleaned up', async () => {
    const before = realtimeService.subscriberCount(ws.workspace_id);
    const { res, controller } = await open(ws.workspace_id, admin);
    assert.equal(res.status, 200);
    assert.equal(realtimeService.subscriberCount(ws.workspace_id), before + 1);
    controller.abort();
    controllers.forEach(c => c.abort());
    assert.ok(await waitFor(() => realtimeService.subscriberCount(ws.workspace_id) === 0));
    assert.equal(realtimeService.subscriberCount(otherWs.workspace_id), 0);
  });
});
