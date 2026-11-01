const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const searchService = require('../src/services/searchService');

test('REQ-6.2: date-range filters exclude tasks with no due date', async (t) => {
  let workspaceId;

  t.beforeEach(() => {
    db.reset();
    const user = db.createUser({ email: 'gagan@pes.edu', full_name: 'Gagan', password_hash: 'hash' });
    workspaceId = db.createWorkspace({ title: 'WS', owner_id: user.user_id }).workspace_id;
    const mk = (title, due_date) => db.createTask({ workspace_id: workspaceId, title, status: 'To-Do', priority: 'Medium', created_by: user.user_id, due_date });
    mk('early', '2026-01-10');
    mk('mid', '2026-02-10');
    mk('late', '2026-03-10');
    mk('undated');
  });

  const titles = (res) => res.data.map(x => x.title).sort();

  await t.test('no range keeps undated tasks', () => {
    assert.deepEqual(titles(searchService.queryTasks({ workspaceId })), ['early', 'late', 'mid', 'undated']);
  });

  await t.test('start only excludes undated tasks', () => {
    assert.deepEqual(titles(searchService.queryTasks({ workspaceId, startDate: '2026-02-01' })), ['late', 'mid']);
  });

  await t.test('end only excludes undated tasks', () => {
    assert.deepEqual(titles(searchService.queryTasks({ workspaceId, endDate: '2026-02-15' })), ['early', 'mid']);
  });

  await t.test('start and end exclude undated tasks', () => {
    assert.deepEqual(titles(searchService.queryTasks({ workspaceId, startDate: '2026-02-01', endDate: '2026-02-15' })), ['mid']);
  });
});
