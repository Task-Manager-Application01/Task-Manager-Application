const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');

const DAY_MS = 24 * 60 * 60 * 1000;

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    http.get({
      port: server.address().port,
      path,
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(raw) }));
    }).on('error', reject);
  });
}

test('UT-RPT-01: KPI sprint window (REQ-7.1)', async t => {
  db.reset();
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const user = db.createUser({ email: 'kpi@example.com', full_name: 'KPI', password_hash: 'hash' });
  const token = generateJWT({ userId: user.user_id, email: user.email, name: user.full_name });
  const workspace = db.createWorkspace({ title: 'KPI', owner_id: user.user_id });
  const addDoneTask = ageInDays => {
    const task = db.createTask({
      workspace_id: workspace.workspace_id,
      title: `Done ${ageInDays} days ago`,
      status: 'Done',
      created_by: user.user_id
    });
    db.tasks.get(task.task_id).updated_at = new Date(Date.now() - ageInDays * DAY_MS).toISOString();
  };
  addDoneTask(1);
  addDoneTask(2);
  addDoneTask(10);

  const path = `/api/v1/workspaces/${workspace.workspace_id}/analytics/kpi`;
  const velocity = async query => {
    const res = await get(server, path + query, token);
    assert.equal(res.statusCode, 200);
    return res.data.data.team_velocity_per_week;
  };

  await t.test('default window is 14 days', async () => {
    assert.equal(await velocity(''), 1.5);
  });

  await t.test('custom windows change which completions count', async () => {
    assert.equal(await velocity('?sprint_days=7'), 2);
    assert.equal(await velocity('?sprint_days=30'), 0.7);
  });

  await t.test('invalid windows return 400', async () => {
    for (const value of ['0', '-1', '1.5', 'abc', '', '1000']) {
      const res = await get(server, `${path}?sprint_days=${value}`, token);
      assert.equal(res.statusCode, 400, `sprint_days=${value}`);
    }
  });
});
