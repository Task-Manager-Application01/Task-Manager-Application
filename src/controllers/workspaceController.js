const { db } = require('../models/Database');
const rbacService = require('../services/rbacService');
const { sanitizeString } = require('../middleware/validationMiddleware');

/**
 * Workspace Controller (Owner: Chetana V Iyer | PES1UG24CS130)
 * Feature 2 — Workspace & Team Collaboration Management
 * REQ-2.1, REQ-2.2, REQ-2.3 | ARC-TEAM | DSN-02
 */
class WorkspaceController {
  /**
   * REQ-2.1 (Workspace Creation):
   * Authenticated user instantiates workspace with custom title and team description.
   */
  async listWorkspaces(req, res) {
    try {
      const userId = req.user && req.user.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'A valid authentication token is required.'
        });
      }

      const workspaces = db.listWorkspacesForUser(userId);

      return res.status(200).json({
        success: true,
        count: workspaces.length,
        data: workspaces
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: 'Unable to retrieve workspaces.'
      });
    }
  }
  async createWorkspace(req, res) {
    try {
      const { title, description } = req.body;
      const ownerId = req.user ? req.user.userId : req.body.owner_id;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Validation Error', message: 'Workspace title is required.' });
      }

      if (!ownerId) {
        return res.status(400).json({ success: false, error: 'Validation Error', message: 'owner_id is required.' });
      }

      const workspace = db.createWorkspace({
        title: sanitizeString(title),
        description: sanitizeString(description || ''),
        owner_id: ownerId
      });

      db.logAuditEvent({
        workspace_id: workspace.workspace_id,
        actor_id: ownerId,
        action: 'WORKSPACE_CREATED',
        target_entity: 'WORKSPACE',
        target_id: workspace.workspace_id,
        details: { title: workspace.title }
      });

      return res.status(201).json({
        success: true,
        message: 'Workspace created successfully.',
        data: workspace
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-2.2 (Member Invitation & Roles):
   * Workspace Admins invite users via email and assign explicit roles (Admin, Member, Viewer).
   */
  async inviteMember(req, res) {
    try {
      const { workspaceId } = req.params;
      const { email, role = 'Member' } = req.body;
      const actorId = req.user ? req.user.userId : req.body.actor_id;

      const VALID_ROLES = ['Admin', 'Member', 'Viewer'];
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Role must be one of: ${VALID_ROLES.join(', ')}.`
        });
      }

      // Check admin permissions
      if (actorId && !rbacService.canPerformDestructiveAction(workspaceId, actorId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Only Workspace Admins can invite members and configure roles.'
        });
      }

      // Find or create user stub
      let user = db.findUserByEmail(email);
      if (!user) {
        user = db.createUser({
          email: email.toLowerCase(),
          full_name: email.split('@')[0],
          password_hash: 'PENDING_INVITATION'
        });
      }

      const membership = db.addMembership({
        workspace_id: workspaceId,
        user_id: user.user_id,
        role
      });

      db.logAuditEvent({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'MEMBER_INVITED',
        target_entity: 'MEMBERSHIP',
        target_id: membership.membership_id,
        details: { email, role }
      });

      return res.status(200).json({
        success: true,
        message: `User '${email}' assigned role '${role}' in workspace.`,
        data: membership
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-2.3 (Access Enforcement - Settings Update):
   * Strictly restricted to users holding the Admin role.
   */
  async updateWorkspaceSettings(req, res) {
    try {
      const { workspaceId } = req.params;
      const actorId = req.user ? req.user.userId : req.body.actor_id;

      if (!rbacService.canPerformDestructiveAction(workspaceId, actorId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Access denied: Restrictive mutation requires Admin role.'
        });
      }

      const updates = {};
      if (req.body.title) updates.title = sanitizeString(req.body.title);
      if (req.body.description !== undefined) updates.description = sanitizeString(req.body.description);

      const updated = db.updateWorkspace(workspaceId, updates);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Not Found', message: 'Workspace not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Workspace settings updated.',
        data: updated
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-2.3 & Business Rule 2 (Workspace Deletion):
   * Admin only. Cascades soft-deletion to all associated tasks, subtasks, files.
   */
  async deleteWorkspace(req, res) {
    try {
      const { workspaceId } = req.params;
      const actorId = req.user ? req.user.userId : req.body.actor_id;

      if (!rbacService.canPerformDestructiveAction(workspaceId, actorId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Access denied: Only Workspace Admins can delete a workspace.'
        });
      }

      const success = db.deleteWorkspace(workspaceId);
      if (!success) {
        return res.status(404).json({ success: false, error: 'Not Found', message: 'Workspace not found.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Workspace and all associated tasks soft-deleted successfully (Business Rule 2).'
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * List members of a workspace
   */
  async listMembers(req, res) {
    try {
      const { workspaceId } = req.params;
      const members = db.listWorkspaceMembers(workspaceId);
      return res.status(200).json({ success: true, count: members.length, data: members });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }
}

module.exports = new WorkspaceController();
