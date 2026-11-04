const { db } = require('../models/Database');
const rbacService = require('../services/rbacService');
const auditLogger = require('../services/auditLogger');
const { sanitizeString } = require('../middleware/validationMiddleware');
const { hashPassword, generateJWT } = require('../middleware/authMiddleware');
const { EMAIL_REGEX, PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } = require('../middleware/passwordPolicy');
const emailService = require('../services/emailService');
const realtimeService = require('../services/realtimeService');

const PENDING_INVITATION_HASH = 'PENDING_INVITATION';
const INVALID_INVITATION_MESSAGE = 'This invitation is invalid, has expired, or has already been used.';

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
   * Workspace Admins invite users by email and assign explicit roles (Admin, Member, Viewer).
   *
   * This only creates a pending invitation and emails a one-time token. The invitee gets no
   * workspace access until they accept it (see acceptInvitation).
   */
  async inviteMember(req, res) {
    try {
      const { workspaceId } = req.params;
      const body = req.body || {};
      const { role = 'Member' } = body;
      const actorId = req.user ? req.user.userId : body.actor_id;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

      const VALID_ROLES = ['Admin', 'Member', 'Viewer'];
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Role must be one of: ${VALID_ROLES.join(', ')}.`
        });
      }

      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'A valid email address is required.'
        });
      }

      if (!actorId || !rbacService.canPerformDestructiveAction(workspaceId, actorId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Only Workspace Admins can invite members and configure roles.'
        });
      }

      const workspace = db.getWorkspace(workspaceId);
      if (!workspace) {
        return res.status(404).json({ success: false, error: 'Not Found', message: 'Workspace not found.' });
      }

      const existing = db.findUserByEmail(email);
      if (existing && db.getMembership(workspaceId, existing.user_id)) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'This user is already a member of the workspace.'
        });
      }

      const { invitation, token } = db.createInvitation({
        workspace_id: workspaceId,
        email,
        role,
        invited_by: actorId
      });

      const inviter = db.getUser(actorId);
      const days = Math.round(db.INVITATION_TTL_MS / (24 * 60 * 60 * 1000));
      emailService.send({
        to: email,
        subject: `You have been invited to join "${workspace.title}"`,
        text:
          `${inviter ? inviter.full_name : 'A workspace admin'} invited you to join the workspace ` +
          `"${workspace.title}" as ${role}.\n\n` +
          `Your invitation token is: ${token}\n\n` +
          `Send it to POST /api/v1/invitations/accept within ${days} days. ` +
          'New users also send a full_name and password to create their account; ' +
          'existing users send it while signed in. The token works once.'
      });

      db.logAuditEvent({
        workspace_id: workspaceId,
        actor_id: actorId,
        action: 'MEMBER_INVITED',
        target_entity: 'INVITATION',
        target_id: invitation.invitation_id,
        details: { email, role }
      });

      return res.status(201).json({
        success: true,
        message: `Invitation sent to '${email}' for role '${role}'. Access starts when it is accepted.`,
        data: invitation
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-2.2 (Invitee accepts): consumes a one-time invitation token and grants the invited role.
   *
   * - New email: the body must also carry full_name and password; the account is created and a
   *   JWT is returned, so the invitee can log in straight away.
   * - Existing account: the caller must be signed in as that account.
   * Expired, used, revoked and unknown tokens all get the same 400 response.
   */
  async acceptInvitation(req, res) {
    try {
      const body = req.body || {};
      const invitation = db.findInvitationByToken(body.token);

      if (!db.isInvitationUsable(invitation) || !db.getWorkspace(invitation.workspace_id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Invitation',
          message: INVALID_INVITATION_MESSAGE
        });
      }

      const existing = db.findUserByEmail(invitation.email);
      const hasRealAccount = Boolean(existing) && existing.password_hash !== PENDING_INVITATION_HASH;

      let user;
      let createdAccount = false;

      if (hasRealAccount) {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: `Sign in as ${invitation.email} to accept this invitation.`
          });
        }
        if (req.user.userId !== existing.user_id) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'This invitation was sent to a different account.'
          });
        }
        user = existing;
      } else {
        const fullName = typeof body.full_name === 'string' ? sanitizeString(body.full_name) : '';
        const errors = [];
        if (fullName.length === 0) errors.push('full_name is required.');
        if (typeof body.password !== 'string' || !PASSWORD_REGEX.test(body.password)) {
          errors.push(PASSWORD_RULE_MESSAGE);
        }
        if (errors.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Validation Error',
            message: 'Set up your account to accept this invitation.',
            details: errors
          });
        }

        const passwordHash = hashPassword(body.password);
        user = existing
          ? db.activateUser(existing.user_id, { full_name: fullName, password_hash: passwordHash })
          : db.createUser({ email: invitation.email, full_name: fullName, password_hash: passwordHash });
        createdAccount = true;
      }

      // Everything below runs without awaiting, so a token cannot be used twice concurrently.
      db.markInvitationAccepted(invitation.invitation_id);

      if (db.getMembership(invitation.workspace_id, user.user_id)) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'You are already a member of this workspace.'
        });
      }

      const membership = db.addMembership({
        workspace_id: invitation.workspace_id,
        user_id: user.user_id,
        role: invitation.role
      });

      db.logAuditEvent({
        workspace_id: invitation.workspace_id,
        actor_id: user.user_id,
        action: 'MEMBER_JOINED',
        target_entity: 'MEMBERSHIP',
        target_id: membership.membership_id,
        details: { email: invitation.email, role: invitation.role, invitation_id: invitation.invitation_id }
      });

      const data = {
        user_id: user.user_id,
        workspace_id: membership.workspace_id,
        membership_id: membership.membership_id,
        role: membership.role
      };
      if (createdAccount) {
        data.full_name = user.full_name;
        data.email = user.email;
        data.token = generateJWT({ userId: user.user_id, email: user.email, name: user.full_name });
      }

      return res.status(200).json({
        success: true,
        message: `Invitation accepted. You joined the workspace as ${membership.role}.`,
        data
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: 'Unable to accept the invitation.' });
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

      auditLogger.log({
        workspaceId,
        actorId,
        action: 'WORKSPACE_UPDATED',
        targetEntity: 'WORKSPACE',
        targetId: workspaceId,
        details: updates
      });

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

      auditLogger.log({
        workspaceId,
        actorId,
        action: 'WORKSPACE_ARCHIVED',
        targetEntity: 'WORKSPACE',
        targetId: workspaceId,
        details: {}
      });

      return res.status(200).json({
        success: true,
        message: 'Workspace and all associated tasks soft-deleted successfully (Business Rule 2).'
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message });
    }
  }

  /**
   * REQ-2.3 (Member Revocation):
   * Admin only. Removes a member, ends their access at once, and records the action.
   * A workspace can never be left without an Admin.
   */
  async removeMember(req, res) {
    try {
      const { workspaceId, userId } = req.params;
      const actorId = req.user ? req.user.userId : (req.body || {}).actor_id;

      if (!actorId || !rbacService.canPerformDestructiveAction(workspaceId, actorId)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Access denied: Only Workspace Admins can remove members.'
        });
      }

      const target = db.getMembership(workspaceId, userId);
      if (!target) {
        return res.status(404).json({ success: false, error: 'Not Found', message: 'That user is not a member of this workspace.' });
      }

      if (target.role === 'Admin' && db.countWorkspaceAdmins(workspaceId) <= 1) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'A workspace must keep at least one Admin. Make another member an Admin first.'
        });
      }

      db.removeMembership(workspaceId, userId);
      const unassigned = db.unassignUserFromWorkspaceTasks(workspaceId, userId);
      realtimeService.disconnectUser(workspaceId, userId);

      auditLogger.log({
        workspaceId,
        actorId,
        action: 'MEMBER_REMOVED',
        targetEntity: 'MEMBERSHIP',
        targetId: target.membership_id,
        details: { user_id: userId, role: target.role, tasks_unassigned: unassigned }
      });

      return res.status(200).json({
        success: true,
        message: 'Member removed from the workspace.',
        data: { workspace_id: workspaceId, user_id: userId, tasks_unassigned: unassigned }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal Server Error', message: 'Unable to remove the member.' });
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
