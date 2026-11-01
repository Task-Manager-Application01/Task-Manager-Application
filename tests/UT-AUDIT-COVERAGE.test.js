const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const auditLogger = require('../src/services/auditLogger');
const subtaskController = require('../src/controllers/subtaskController');
const fileUploadService = require('../src/services/fileUploadService');

function mockRes() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('REQ-8.3: subtask and attachment actions are audited', async t => {
  let user, workspace, task;

  const request = (params, body = {}) => ({ params, body, user: { userId: user.user_id } });
  const latest = () => auditLogger.getTimeline(workspace.workspace_id)[0];
  const assertEvent = (action, targetEntity, targetId) => {
    const entry = latest();
    assert.equal(entry.action, action);
    assert.equal(entry.actor_id, user.user_id);
    assert.equal(entry.target_entity, targetEntity);
    assert.equal(entry.target_id, targetId);
    assert.ok(entry.timestamp);
  };
  const addSubtask = async title => {
    const res = mockRes();
    await subtaskController.addSubtask(request({ taskId: task.task_id }, { title }), res);
    return res.body.data.subtask;
  };

  t.beforeEach(() => {
    db.reset();
    user = db.createUser({ email: 'audit@example.com', full_name: 'Audit', password_hash: 'hash' });
    workspace = db.createWorkspace({ title: 'Audit', owner_id: user.user_id });
    task = db.createTask({ workspace_id: workspace.workspace_id, title: 'Task', created_by: user.user_id });
  });

  await t.test('subtask create', async () => {
    const subtask = await addSubtask('First');
    assertEvent('SUBTASK_CREATED', 'SUBTASK', subtask.subtask_id);
  });

  await t.test('subtask update', async () => {
    const subtask = await addSubtask('First');
    await subtaskController.updateSubtask(request({ subtaskId: subtask.subtask_id }, { is_completed: true }), mockRes());
    assertEvent('SUBTASK_UPDATED', 'SUBTASK', subtask.subtask_id);
    assert.equal(latest().details.is_completed, true);
  });

  await t.test('subtask reorder', async () => {
    const first = await addSubtask('First');
    const second = await addSubtask('Second');
    const orderedSubtaskIds = [second.subtask_id, first.subtask_id];
    await subtaskController.reorderSubtasks(request({ taskId: task.task_id }, { orderedSubtaskIds }), mockRes());
    assertEvent('SUBTASKS_REORDERED', 'SUBTASK', task.task_id);
  });

  await t.test('subtask delete', async () => {
    const subtask = await addSubtask('First');
    await subtaskController.deleteSubtask(request({ subtaskId: subtask.subtask_id }), mockRes());
    assertEvent('SUBTASK_DELETED', 'SUBTASK', subtask.subtask_id);
  });

  await t.test('failed subtask actions are not logged', async () => {
    const res = mockRes();
    await subtaskController.addSubtask(request({ taskId: task.task_id }, { title: '' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(auditLogger.getTimeline(workspace.workspace_id).length, 0);
  });

  await t.test('attachment upload', async () => {
    const { attachment } = await fileUploadService.processAttachment({
      taskId: task.task_id,
      fileName: 'notes.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      uploadedBy: user.user_id
    });
    assertEvent('ATTACHMENT_UPLOADED', 'ATTACHMENT', attachment.attachment_id);
  });

  await t.test('rejected attachment is not logged', async () => {
    await assert.rejects(fileUploadService.processAttachment({
      taskId: task.task_id,
      fileName: 'virus.exe',
      fileSize: 1024,
      mimeType: 'application/x-msdownload',
      uploadedBy: user.user_id
    }));
    assert.equal(auditLogger.getTimeline(workspace.workspace_id).length, 0);
  });
});
