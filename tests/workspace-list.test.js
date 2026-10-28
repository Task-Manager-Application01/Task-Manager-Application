const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');

test('workspace listing requires authentication and isolates users', async () => {
  db.reset();

  const user = db.createUser({
    full_name: 'Workspace Test User',
    email: 'workspace-test@example.com',
    password_hash: 'test-hash'
  });

  const otherUser = db.createUser({
    full_name: 'Other Test User',
    email: 'other-test@example.com',
    password_hash: 'test-hash'
  });

  db.createWorkspace({
    title: 'My Workspace',
    description: 'Workspace owned by the authenticated user',
    owner_id: user.user_id
  });

  db.createWorkspace({
    title: 'Other Workspace',
    description: 'Workspace owned by another user',
    owner_id: otherUser.user_id
  });

  const server = createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const endpoint =
      `http://127.0.0.1:${server.address().port}/api/v1/workspaces`;

    const unauthorized = await fetch(endpoint);
    assert.equal(unauthorized.status, 401);

    const token = generateJWT({
      userId: user.user_id,
      email: user.email
    });

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.equal(body.success, true);
    assert.equal(body.count, 1);
    assert.equal(body.data[0].title, 'My Workspace');
    assert.equal(body.data[0].role, 'Admin');
  } finally {
    server.closeAllConnections();

    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
      });
    }
  }
});