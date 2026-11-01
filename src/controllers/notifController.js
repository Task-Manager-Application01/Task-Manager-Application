const { db } = require('../models/Database');

/**
 * Notification Controller
 * Owner: Harsh Pandya | PES1UG24CS182
 * Feature 8 — Notification & Activity Audit Feed
 * REQ-8.1, REQ-8.2 | ARC-NOTIF | DSN-08
 */
class NotificationController {
  /**
   * REQ-8.1 (In-App Notification Center):
   * Retrieves all notifications for the authenticated user with read/unread tracking.
   */
  async getUserNotifications(req, res) {
    try {
      const requestedUserId = req.params.userId;
      if (req.user && requestedUserId && requestedUserId !== req.user.userId) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'You may only view your own notifications.' });
      }
      const userId = req.user ? req.user.userId : requestedUserId;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required.' });
      }

      const notifs = db.getNotificationsForUser(userId);
      const unreadCount = notifs.filter(n => !n.is_read).length;

      return res.status(200).json({
        success: true,
        unread_count: unreadCount,
        data: notifs
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-8.1: Mark notification as read
   */
  async markRead(req, res) {
    try {
      const { notifId } = req.params;
      const notification = [...db.notifications.values()].find(n => n.notification_id === notifId);
      if (!notification) {
        return res.status(404).json({ success: false, error: 'Notification not found.' });
      }
      if (req.user && notification.user_id !== req.user.userId) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: 'You may only update your own notifications.' });
      }
      const success = db.markNotificationAsRead(notifId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Notification not found.' });
      }

      return res.status(200).json({ success: true, message: 'Notification marked as read.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-8.2 (Automated Deadline Alerts):
   * Scans tasks approaching deadlines within 24 hours and dispatches alerts to assignees.
   */
  async triggerDeadlineCheck(req, res) {
    try {
      const now = new Date();
      const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const activeTasks = db.findTasks(t => t.status !== 'Done' && t.due_date);

      const generatedAlerts = [];

      activeTasks.forEach(task => {
        const dueDate = new Date(task.due_date);
        // If due date is within the next 24 hours (or overdue)
        if (dueDate <= next24Hours) {
          const assignees = task.assignees || [];
          assignees.forEach(uid => {
            const alreadyDispatched = db.getNotificationsForUser(uid).some(notification =>
              notification.type === 'DEADLINE' &&
              notification.target_entity_id === task.task_id &&
              Date.now() - new Date(notification.created_at).getTime() < 24 * 60 * 60 * 1000
            );
            if (alreadyDispatched) return;
            const notif = db.createNotification({
              user_id: uid,
              title: 'Approaching Deadline Alert (24h)',
              message: `Task '${task.title}' is due on ${task.due_date}. Please complete required deliverables.`,
              type: 'DEADLINE',
              target_entity_id: task.task_id
            });
            generatedAlerts.push(notif);
          });
        }
      });

      return res.status(200).json({
        success: true,
        message: `Deadline alert scan completed. Dispatched ${generatedAlerts.length} notification(s).`,
        dispatched_count: generatedAlerts.length,
        alerts: generatedAlerts
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }
}

module.exports = new NotificationController();
