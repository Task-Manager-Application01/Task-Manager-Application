const { db } = require('../models/Database');

/**
 * Immutable Activity Audit Logger Service
 * Owner: Harsh Pandya | PES1UG24CS182
 * Feature 8 — Notification & Activity Audit Feed
 * REQ-8.3 | ARC-NOTIF | DSN-08
 */
class AuditLoggerService {
  /**
   * REQ-8.3 (Immutable Activity Audit Log):
   * Appends an unmodifiable event record to the workspace timeline.
   */
  log({ workspaceId, actorId, action, targetEntity, targetId, details = {} }) {
    if (!action || !targetEntity) {
      throw new Error('Audit log entry requires action and targetEntity.');
    }

    const immutableDetails = JSON.parse(JSON.stringify(details));
    return db.logAuditEvent({
      workspace_id: workspaceId,
      actor_id: actorId || 'SYSTEM',
      action,
      target_entity: targetEntity,
      target_id: targetId,
      details: immutableDetails
    });
  }

  /**
   * Retrieves timeline events for a workspace
   */
  getTimeline(workspaceId) {
    const logs = db.getAuditLogs(workspaceId);
    return [...logs].reverse(); // Most recent first
  }
}

module.exports = new AuditLoggerService();
