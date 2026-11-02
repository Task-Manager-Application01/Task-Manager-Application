const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');

test('REQ-5.2: Kanban board page', async (t) => {
  db.reset();
  const admin = db.createUser({ email: 'kb-admin@example.com', full_name: 'Ada Admin', password_hash: 'h' });
  const viewer = db.createUser({ email: 'kb-viewer@example.com', full_name: 'Vi Viewer', password_hash: 'h' });
  const ws = db.createWorkspace({ title: 'Secret Board', owner_id: admin.user_id });
  db.addMembership({ workspace_id: ws.workspace_id, user_id: viewer.user_id, role: 'Viewer' });
  const task = db.createTask({ workspace_id: ws.workspace_id, title: 'Card', status: 'To-Do', priority: 'Low', created_by: admin.user_id });

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = user => generateJWT({ userId: user.user_id, email: user.email });
  const move = (user, targetColumn) => fetch(`${base}/api/v1/tasks/${task.task_id}/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${token(user)}` } : {})
    },
    body: JSON.stringify({ targetColumn })
  });

  await t.test('serves the page, with no workspace data in it', async () => {
    const res = await fetch(`${base}/kanban`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(body.includes('id="board"'));
    assert.ok(!body.includes('Secret Board'));
  });

  await t.test('the page shows all four columns and sends the token on every API call', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'kanban.html'), 'utf8');
    for (const column of ['To-Do', 'In-Progress', 'Review', 'Done']) {
      assert.ok(page.includes(`id: '${column}'`), column);
    }
    assert.ok(page.includes('Authorization = `Bearer ${token}`'));
    assert.ok(!/fetch\(/.test(page.replace(/const response = await fetch\(path/, '')), 'all requests go through api()');
    assert.ok(!page.includes('actorId'));
    assert.ok(page.includes('assignee_avatars'));
    assert.ok(page.includes('board = snapshot'), 'a failed move is reverted');
    assert.ok(!page.includes('innerHTML'), 'card text is never parsed as HTML');
  });

  await t.test('board data carries avatars for the page to render', async () => {
    db.updateTask(task.task_id, { assignees: [admin.user_id] });
    const res = await fetch(`${base}/api/v1/workspaces/${ws.workspace_id}/kanban`, {
      headers: { Authorization: `Bearer ${token(viewer)}` }
    });
    const { data } = await res.json();
    assert.equal(data['To-Do'][0].assignee_avatars[0].initials, 'AA');
  });

  await t.test('moves need a token and are refused for viewers', async () => {
    assert.equal((await move(null, 'Done')).status, 401);
    assert.equal((await move(viewer, 'Done')).status, 403);
    assert.equal(db.getTask(task.task_id).status, 'To-Do');
    assert.equal((await move(admin, 'Done')).status, 200);
    assert.equal(db.getTask(task.task_id).status, 'Done');
  });

  await t.test('the board API itself still requires a token', async () => {
    assert.equal((await fetch(`${base}/api/v1/workspaces/${ws.workspace_id}/kanban`)).status, 401);
  });

  await t.test('the unused React component is gone', () => {
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'components', 'KanbanBoard.jsx')));
  });
});
