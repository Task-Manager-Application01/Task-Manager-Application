const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    http.get({
      port: server.address().port,
      path,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('REQ-7.2: analytics charts page', async t => {
  db.reset();
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  await t.test('serves the page, with no workspace data in it', async () => {
    const owner = db.createUser({ email: 'o@example.com', full_name: 'Owner', password_hash: 'hash' });
    db.createWorkspace({ title: 'Secret Workspace', owner_id: owner.user_id });

    const page = await get(server, '/analytics');

    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.ok(page.body.includes('id="status-chart"'));
    assert.ok(page.body.includes('id="workload-chart"'));
    assert.ok(!page.body.includes('Secret Workspace'));
  });

  await t.test('page script parses and never builds HTML from API data', async () => {
    const { body } = await get(server, '/analytics');
    const script = body.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(script));
    assert.ok(!script.includes('innerHTML'));
  });

  await t.test('chart data stays protected', async () => {
    const owner = db.createUser({ email: 'owner@example.com', full_name: 'Owner', password_hash: 'hash' });
    const outsider = db.createUser({ email: 'out@example.com', full_name: 'Out', password_hash: 'hash' });
    const workspace = db.createWorkspace({ title: 'Charts', owner_id: owner.user_id });
    const path = `/api/v1/workspaces/${workspace.workspace_id}/analytics/distribution`;
    const tokenFor = user => generateJWT({ userId: user.user_id, email: user.email, name: user.full_name });

    assert.equal((await get(server, path)).statusCode, 401);
    assert.equal((await get(server, path, tokenFor(outsider))).statusCode, 403);
    assert.equal((await get(server, path, tokenFor(owner))).statusCode, 200);
  });
});
