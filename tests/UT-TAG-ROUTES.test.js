const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');
const searchService = require('../src/services/searchService');

function authHeaders(user) {
  const token = generateJWT({ userId: user.user_id, email: user.email });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('Colored tag routes (REQ-6.3)', async (t) => {
  db.reset();
  const admin = db.createUser({ email: 'admin-tag@example.com', full_name: 'Admin', password_hash: 'h' });
  const member = db.createUser({ email: 'member-tag@example.com', full_name: 'Member', password_hash: 'h' });
  const viewer = db.createUser({ email: 'viewer-tag@example.com', full_name: 'Viewer', password_hash: 'h' });
  const outsider = db.createUser({ email: 'outsider-tag@example.com', full_name: 'Outsider', password_hash: 'h' });
  const ws = db.createWorkspace({ title: 'Tags', owner_id: admin.user_id });
  const other = db.createWorkspace({ title: 'Other', owner_id: admin.user_id });
  db.addMembership({ workspace_id: ws.workspace_id, user_id: member.user_id, role: 'Member' });
  db.addMembership({ workspace_id: ws.workspace_id, user_id: viewer.user_id, role: 'Viewer' });

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/workspaces`;
  const tagsUrl = (id) => `${base}/${id}/tags`;
  const create = (user, body, id = ws.workspace_id) =>
    fetch(tagsUrl(id), { method: 'POST', headers: authHeaders(user), body: JSON.stringify(body) });

  await t.test('requires authentication', async () => {
    assert.equal((await fetch(tagsUrl(ws.workspace_id))).status, 401);
    const res = await fetch(tagsUrl(ws.workspace_id), { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
  });

  await t.test('a member creates a tag and it is listed', async () => {
    const res = await create(member, { name: '  Urgent ', color: '#EF4444' });
    assert.equal(res.status, 201);
    const { data } = await res.json();
    assert.equal(data.name, 'Urgent');
    assert.equal(data.color, '#ef4444');
    assert.equal(data.workspace_id, ws.workspace_id);

    const list = await (await fetch(tagsUrl(ws.workspace_id), { headers: authHeaders(viewer) })).json();
    assert.equal(list.count, 1);
    assert.equal(list.data[0].tag_id, data.tag_id);
  });

  await t.test('color defaults when omitted', async () => {
    const res = await create(admin, { name: 'Default color' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.color, '#3b82f6');
  });

  await t.test('viewers cannot create tags but can list them', async () => {
    assert.equal((await create(viewer, { name: 'Nope' })).status, 403);
    assert.equal((await fetch(tagsUrl(ws.workspace_id), { headers: authHeaders(viewer) })).status, 200);
  });

  await t.test('non-members can neither list nor create', async () => {
    assert.equal((await fetch(tagsUrl(ws.workspace_id), { headers: authHeaders(outsider) })).status, 403);
    assert.equal((await create(outsider, { name: 'Nope' })).status, 403);
  });

  await t.test('unknown workspace returns 404', async () => {
    assert.equal((await fetch(tagsUrl('missing'), { headers: authHeaders(admin) })).status, 404);
  });

  await t.test('names and colors are validated', async () => {
    for (const body of [
      {},
      { name: '   ' },
      { name: 42 },
      { name: 'x'.repeat(51) },
      { name: 'Bad', color: 'red' },
      { name: 'Bad', color: '#fff' },
      { name: 'Bad', color: '#gggggg' },
      { name: 'Bad', color: 123456 }
    ]) {
      const res = await create(admin, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  await t.test('tags are scoped to their workspace', async () => {
    await create(admin, { name: 'Other only' }, other.workspace_id);
    const list = await (await fetch(tagsUrl(ws.workspace_id), { headers: authHeaders(admin) })).json();
    assert.ok(list.data.every(tag => tag.workspace_id === ws.workspace_id));
    assert.ok(!list.data.some(tag => tag.name === 'Other only'));
  });

  await t.test('tag IDs are unique even when created in the same millisecond', () => {
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
      const ids = new Set();
      for (let i = 0; i < 50; i++) {
        ids.add(searchService.createTag({ workspaceId: ws.workspace_id, name: `t${i}` }).tag_id);
      }
      assert.equal(ids.size, 50);
    } finally {
      Date.now = realNow;
    }
  });
});
