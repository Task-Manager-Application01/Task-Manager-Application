const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { db } = require('../src/models/Database');
const analyticsService = require('../src/services/analyticsService');
const reportExporter = require('../src/services/reportExporter');
const notifController = require('../src/controllers/notifController');
const auditLogger = require('../src/services/auditLogger');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }
  };
}

test('Feature Set D: Analytics, Reporting & Audit System (Harsh Pandya - PES1UG24CS182)', async (t) => {
  let workspaceId;
  let user1, user2;

  t.beforeEach(() => {
    db.reset();
    user1 = db.createUser({ email: 'harsh@pes.edu', full_name: 'Harsh Pandya', password_hash: 'hash' });
    user2 = db.createUser({ email: 'rudra@pes.edu', full_name: 'Rudra Dhadhal', password_hash: 'hash' });

    const ws = db.createWorkspace({ title: 'Analytics & Audit Hub', owner_id: user1.user_id });
    workspaceId = ws.workspace_id;
  });

  await t.test('UT-RPT-01: Progress Analytics KPIs and Workload Visual Distribution', async () => {
    // 3 tasks: 1 Done, 1 Overdue, 1 In-Progress
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    db.createTask({
      workspace_id: workspaceId,
      title: 'Completed Task',
      status: 'Done',
      priority: 'High',
      created_by: user1.user_id,
      assignees: [user1.user_id]
    });

    db.createTask({
      workspace_id: workspaceId,
      title: 'Overdue Urgent Task',
      status: 'In-Progress',
      due_date: pastDate.toISOString().split('T')[0],
      priority: 'High',
      created_by: user1.user_id,
      assignees: [user2.user_id]
    });

    db.createTask({
      workspace_id: workspaceId,
      title: 'Ongoing Work',
      status: 'To-Do',
      due_date: futureDate.toISOString().split('T')[0],
      priority: 'Low',
      created_by: user1.user_id,
      assignees: [user1.user_id, user2.user_id]
    });

    // REQ-7.1 KPI Dashboard
    const kpis = analyticsService.getKPIMetrics(workspaceId);
    assert.equal(kpis.total_tasks, 3);
    assert.equal(kpis.completed_tasks, 1);
    assert.equal(kpis.overdue_tasks, 1);
    assert.equal(kpis.completion_rate_percentage, 33);

    // REQ-7.2 Visual Distribution
    const dist = analyticsService.getVisualDistribution(workspaceId);
    assert.equal(dist.status_distribution['Done'], 1);
    assert.equal(dist.status_distribution['In-Progress'], 1);
    assert.equal(dist.status_distribution['To-Do'], 1);

    const user1Workload = dist.member_workload.find(w => w.user_id === user1.user_id);
    assert.ok(user1Workload);
    assert.equal(user1Workload.assigned_count, 2);
    assert.equal(user1Workload.completed_count, 1);
  });

  await t.test('UT-RPT-02: CSV and Document Report Generation', async () => {
    db.createTask({
      workspace_id: workspaceId,
      title: 'Reportable Item 1',
      priority: 'Medium',
      status: 'To-Do',
      created_by: user1.user_id
    });

    // CSV format verification (REQ-7.3)
    const csvContent = reportExporter.exportToCSV(workspaceId);
    assert.ok(csvContent.startsWith('"Task ID","Workspace ID","Title"'));
    assert.ok(csvContent.includes('"Reportable Item 1"'));

    // RFC 4180: CRLF between records, with quotes, commas and newlines kept in quoted fields
    assert.equal(csvContent.split('\r\n').length, 2);

    // Structured Document summary
    const summary = reportExporter.exportToDocumentSummary(workspaceId);
    assert.equal(summary.task_count, 1);
    assert.equal(summary.tasks[0].title, 'Reportable Item 1');

    db.createTask({
      workspace_id: workspaceId,
      title: 'Has "quotes", commas\nand a newline',
      priority: 'Medium',
      status: 'To-Do',
      created_by: user1.user_id
    });
    const escapedCsv = reportExporter.exportToCSV(workspaceId);
    assert.equal(escapedCsv.split('\r\n').length, 3);
    assert.ok(escapedCsv.includes('"Has ""quotes"", commas\nand a newline"'));
  });

  await t.test('UT-NOTIF-01: In-App Notification Center with Read/Unread Tracking', async () => {
    const notif = db.createNotification({
      user_id: user2.user_id,
      title: 'Review Requested',
      message: 'Please review code changes.',
      type: 'COMMENT'
    });

    const reqList = { params: { userId: user2.user_id } };
    const resList = mockRes();
    await notifController.getUserNotifications(reqList, resList);

    assert.equal(resList.statusCode, 200);
    assert.equal(resList.body.unread_count, 1);
    assert.equal(resList.body.data[0].notification_id, notif.notification_id);

    // Mark as read
    const reqRead = { params: { notifId: notif.notification_id } };
    const resRead = mockRes();
    await notifController.markRead(reqRead, resRead);
    assert.equal(resRead.statusCode, 200);

    // Verify unread count becomes 0
    const resListAfter = mockRes();
    await notifController.getUserNotifications(reqList, resListAfter);
    assert.equal(resListAfter.body.unread_count, 0);
  });

  await t.test('UT-NOTIF-02: Activity Audit Log & Automated 24h Deadline Alerts', async () => {
    // 1. Audit Log (REQ-8.3 Immutable Timeline)
    auditLogger.log({
      workspaceId,
      actorId: user1.user_id,
      action: 'MEMBER_INVITED',
      targetEntity: 'MEMBERSHIP',
      targetId: 'm_123',
      details: { role: 'Contributor' }
    });

    const timeline = auditLogger.getTimeline(workspaceId);
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].action, 'MEMBER_INVITED');
    assert.equal(timeline[0].target_entity, 'MEMBERSHIP');

    // 2. Deadline alert check (REQ-8.2)
    const dueSoon = new Date(Date.now() + 12 * 60 * 60 * 1000);
    db.createTask({
      workspace_id: workspaceId,
      title: 'Urgent Capstone Submission',
      status: 'In-Progress',
      due_date: dueSoon.toISOString().split('T')[0],
      created_by: user1.user_id,
      assignees: [user2.user_id]
    });

    const resDeadline = mockRes();
    await notifController.triggerDeadlineCheck({}, resDeadline);
    assert.equal(resDeadline.statusCode, 200);
    assert.ok(resDeadline.body.dispatched_count >= 1);

    const user2Notifs = db.getNotificationsForUser(user2.user_id);
    assert.ok(user2Notifs.some(n => n.type === 'DEADLINE'));
  });
});
