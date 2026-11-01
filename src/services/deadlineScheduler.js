const { db } = require('../models/Database');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deadline Alert Scheduler
 * Owner: Harsh Pandya | PES1UG24CS182
 * Feature 8 — Notification & Activity Audit Feed
 * REQ-8.2 | ARC-NOTIF | DSN-08
 */
class DeadlineScheduler {
  constructor() {
    this.timer = null;
  }

  /**
   * Alerts assignees of tasks due within 24 hours, at most once per task every 24 hours.
   * Scans every workspace unless workspaceId is given.
   */
  runCheck({ workspaceId, now = new Date() } = {}) {
    const cutoff = new Date(now.getTime() + DAY_MS);
    const tasks = db.findTasks(task =>
      task.status !== 'Done' &&
      task.due_date &&
      (!workspaceId || task.workspace_id === workspaceId) &&
      new Date(task.due_date) <= cutoff
    );

    const alerts = [];
    tasks.forEach(task => {
      (task.assignees || []).forEach(userId => {
        if (this.wasRecentlyAlerted(userId, task.task_id, now)) return;
        alerts.push(db.createNotification({
          user_id: userId,
          title: 'Approaching Deadline Alert (24h)',
          message: `Task '${task.title}' is due on ${task.due_date}. Please complete required deliverables.`,
          type: 'DEADLINE',
          target_entity_id: task.task_id
        }));
      });
    });
    return alerts;
  }

  wasRecentlyAlerted(userId, taskId, now) {
    return db.getNotificationsForUser(userId).some(notification =>
      notification.type === 'DEADLINE' &&
      notification.target_entity_id === taskId &&
      now.getTime() - new Date(notification.created_at).getTime() < DAY_MS
    );
  }

  /**
   * Runs a check now and then on an interval. The timer doesn't keep the process alive.
   */
  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this.timer) return;
    const interval = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
    const safeRun = () => {
      try {
        this.runCheck();
      } catch (err) {
        console.error('Deadline check failed:', err.message);
      }
    };
    safeRun();
    this.timer = setInterval(safeRun, interval);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = new DeadlineScheduler();
