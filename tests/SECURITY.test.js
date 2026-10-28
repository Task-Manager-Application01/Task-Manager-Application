const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');

function request(server, { method = 'GET', path, headers = {} }, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('HTTP authorization protects workspace data and request identity', async t => {
  db.reset();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const unauthenticated = await request(server, {
    method: 'POST',
    path: '/api/v1/tasks'
  }, {
    workspace_id: 'missing',
    created_by: 'spoofed-user',
    title: 'Should not be created',
    priority: 'High'
  });
  assert.equal(unauthenticated.statusCode, 401);

  const registration = await request(server, {
    method: 'POST',
    path: '/api/v1/auth/register'
  }, {
    full_name: 'Security Owner',
    email: 'security-owner@example.com',
    password: 'SecurePassword#2026'
  });
  const token = registration.data.data.token;
  const ownerId = registration.data.data.user_id;
  const headers = { Authorization: `Bearer ${token}` };

  const workspace = await request(server, {
    method: 'POST',
    path: '/api/v1/workspaces',
    headers
  }, { title: 'Private Workspace' });
  const workspaceId = workspace.data.data.workspace_id;

  const created = await request(server, {
    method: 'POST',
    path: '/api/v1/tasks',
    headers
  }, {
    workspace_id: workspaceId,
    created_by: 'spoofed-user',
    title: 'Identity must come from token',
    priority: 'Medium'
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.data.data.created_by, ownerId);

  const outsider = db.createUser({
    email: 'outsider@example.com',
    full_name: 'Outsider',
    password_hash: 'hash'
  });
  const outsiderToken = require('../src/middleware/authMiddleware').generateJWT({
    userId: outsider.user_id,
    email: outsider.email,
    name: outsider.full_name
  });
  const crossWorkspace = await request(server, {
    method: 'GET',
    path: `/api/v1/workspaces/${workspaceId}/analytics/kpi`,
    headers: { Authorization: `Bearer ${outsiderToken}` }
  });
  assert.equal(crossWorkspace.statusCode, 403);
});
