const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const taskController = require('../src/controllers/taskController');
const taskDragDrop = require('../src/services/taskDragDrop');

function mockRes() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('REQ-8.1: status-change notifications', async t => {
  let actor, assignee, task;

  const statusAlerts = userId =>
    db.getNotificationsForUser(userId).filter(n => n.type === 'STATUS_CHANGE');

  const update = async body => {
    const res = mockRes();
    await taskController.updateTask({
      params: { taskId: task.task_id },
      body,
      user: { userId: actor.user_id }
    }, res);
    assert.equal(res.statusCode, 200);
  };

  t.beforeEach(() => {
    db.reset();
    actor = db.createUser({ email: 'actor@example.com', full_name: 'Actor', password_hash: 'hash' });
    assignee = db.createUser({ email: 'assignee@example.com', full_name: 'Assignee', password_hash: 'hash' });
    const workspace = db.createWorkspace({ title: 'Status', owner_id: actor.user_id });
    task = db.createTask({
      workspace_id: workspace.workspace_id,
      title: 'Task',
      status: 'To-Do',
      created_by: actor.user_id,
      assignees: [actor.user_id, assignee.user_id]
    });
  });

  await t.test('PUT status change notifies assignees except the actor', async () => {
    await update({ status: 'Review' });

    const alerts = statusAlerts(assignee.user_id);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].target_entity_id, task.task_id);
    assert.match(alerts[0].message, /'To-Do' to 'Review'/);
    assert.equal(statusAlerts(actor.user_id).length, 0);
  });

  await t.test('updates that keep the status send nothing', async () => {
    await update({ title: 'Renamed' });
    await update({ status: 'To-Do' });

    assert.equal(statusAlerts(assignee.user_id).length, 0);
  });

  await t.test('Kanban moves send exactly one notification', () => {
    taskDragDrop.moveCard(task.task_id, 'In-Progress', actor.user_id);

    assert.equal(statusAlerts(assignee.user_id).length, 1);
  });
});
