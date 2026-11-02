const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Database } = require('../src/models/Database');

/**
 * Unit Test Suite: UT-PERSISTENCE
 * Traces to SRS Requirement: SRS 2.4, REQ-NFR-3
 * Owner: Dhadhal Rudra (PES1UG24CS146) - Data & Storage Architect
 */

test('UT-PERSISTENCE: Persistent Storage, Atomic Cascading, and Daily Backups', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-manager-persist-'));
  const backupDirPath = path.join(tempDir, 'backups');

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('REQ-NFR-3 / SRS 2.4: Data survives a simulated server restart', async () => {
    const storageFilePath = path.join(tempDir, 'database-restart.json');
    const db1 = new Database();
    db1.enableAutoPersist(storageFilePath);

    const user = db1.createUser({
      email: 'persist-user@example.com',
      password_hash: 'salted-hash-value',
      full_name: 'Persistent User'
    });

    const workspace = db1.createWorkspace({
      title: 'Persistent Engineering Workspace',
      description: 'Workspace for persistence verification',
      owner_id: user.user_id
    });

    const task = db1.createTask({
      workspace_id: workspace.workspace_id,
      created_by: user.user_id,
      title: 'Persistent Architecture Review',
      priority: 'High',
      assignees: [user.user_id]
    });

    const subtask = db1.createSubtask({
      task_id: task.task_id,
      title: 'Verify File Sync',
      is_completed: false
    });

    const attachment = db1.createAttachment({
      task_id: task.task_id,
      file_name: 'arch_spec.pdf',
      file_size: 1024 * 50,
      mime_type: 'application/pdf',
      uploaded_by: user.user_id
    });

    assert.ok(fs.existsSync(storageFilePath), 'Database storage file must be created on disk');

    // Simulate server reboot by creating a fresh Database instance and loading storage file
    const db2 = new Database();
    const loadSuccess = db2.load(storageFilePath);

    assert.equal(loadSuccess, true, 'Database should successfully load snapshot from disk');
    assert.ok(db2.getUser(user.user_id));
    assert.equal(db2.getUser(user.user_id).email, 'persist-user@example.com');
    assert.ok(db2.getWorkspace(workspace.workspace_id));
    assert.equal(db2.getWorkspace(workspace.workspace_id).title, 'Persistent Engineering Workspace');
    assert.ok(db2.getTask(task.task_id));
    assert.equal(db2.getTask(task.task_id).title, 'Persistent Architecture Review');
    assert.equal(db2.getSubtasksByTaskId(task.task_id).length, 1);
    assert.equal(db2.getSubtasksByTaskId(task.task_id)[0].title, 'Verify File Sync');
    assert.equal(db2.getAttachmentsByTaskId(task.task_id).length, 1);
    assert.equal(db2.getAttachmentsByTaskId(task.task_id)[0].file_name, 'arch_spec.pdf');
  });

  await t.test('REQ-NFR-3: Atomic cascading archiving and permanent deletion persist across restart', async () => {
    const storageFilePath = path.join(tempDir, 'database-cascade.json');
    const db1 = new Database();
    db1.enableAutoPersist(storageFilePath);

    const user = db1.createUser({
      email: 'cascade@example.com',
      password_hash: 'hash',
      full_name: 'Cascade Tester'
    });

    const ws = db1.createWorkspace({
      title: 'Cascade WS',
      owner_id: user.user_id
    });

    const task = db1.createTask({
      workspace_id: ws.workspace_id,
      created_by: user.user_id,
      title: 'Task for Cascading',
      priority: 'Medium'
    });

    const subtask = db1.createSubtask({
      task_id: task.task_id,
      title: 'Cascade Subtask'
    });

    const attachment = db1.createAttachment({
      task_id: task.task_id,
      file_name: 'cascade_doc.pdf',
      file_size: 1024,
      mime_type: 'application/pdf',
      uploaded_by: user.user_id
    });

    // 1. Soft-delete (archive) task
    const archived = db1.archiveTask(task.task_id);
    assert.equal(archived, true);

    // Verify in db1
    assert.equal(db1.getTask(task.task_id), null);
    assert.equal(db1.getTask(task.task_id, true).is_archived, true);
    assert.equal(db1.getSubtasksByTaskId(task.task_id).length, 0);
    assert.equal(db1.getSubtasksByTaskId(task.task_id, true)[0].is_archived, true);
    assert.equal(db1.getAttachmentsByTaskId(task.task_id).length, 0);
    assert.equal(db1.getAttachmentsByTaskId(task.task_id, true)[0].is_archived, true);

    // Simulate restart and verify archive state persisted
    const db2 = new Database();
    db2.load(storageFilePath);
    assert.equal(db2.getTask(task.task_id), null);
    assert.equal(db2.getTask(task.task_id, true).is_archived, true);
    assert.equal(db2.getSubtasksByTaskId(task.task_id, true)[0].is_archived, true);
    assert.equal(db2.getAttachmentsByTaskId(task.task_id, true)[0].is_archived, true);

    // 2. Permanent deletion cascades atomically
    const db3 = new Database();
    db3.enableAutoPersist(storageFilePath);

    const deleted = db3.deleteTaskPermanently(task.task_id);
    assert.equal(deleted, true);

    // Simulate restart and verify permanent deletion persisted
    const db4 = new Database();
    db4.load(storageFilePath);
    assert.equal(db4.getTask(task.task_id, true), null);
    assert.equal(db4.getSubtasksByTaskId(task.task_id, true).length, 0);
    assert.equal(db4.getAttachmentsByTaskId(task.task_id, true).length, 0);
  });

  await t.test('REQ-NFR-3: Automated daily backups create snapshot archives', async () => {
    const db = new Database();
    db.createUser({ email: 'backup-user@example.com', full_name: 'Backup User', password_hash: 'h' });

    // 1. Manual/Scheduled backup generation
    const backupFile = db.backup(backupDirPath);
    assert.ok(fs.existsSync(backupFile));
    assert.ok(backupFile.includes('backup-'));

    const backupContent = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    assert.equal(backupContent.version, 1);
    assert.ok(backupContent.saved_at);
    assert.ok(backupContent.users.length > 0);

    // 2. Daily backup timer control
    db.startDailyBackups(500, backupDirPath);
    assert.ok(db._backupTimer);
    db.stopDailyBackups();
    assert.equal(db._backupTimer, null);
  });
});
