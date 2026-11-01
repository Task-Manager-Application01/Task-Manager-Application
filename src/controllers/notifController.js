const { db } = require('../models/Database');
const deadlineScheduler = require('../services/deadlineScheduler');

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
   * Runs the deadline check on demand. The route limits this to one workspace's Admins.
   */
  async triggerDeadlineCheck(req, res) {
    try {
      const workspaceId = req.body ? req.body.workspace_id : undefined;
      const generatedAlerts = deadlineScheduler.runCheck({ workspaceId });

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
