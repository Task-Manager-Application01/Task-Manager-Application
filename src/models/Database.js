const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

/**
 * Enterprise Transactional Database Store for Task Manager Application
 * Supports Multi-tenant Workspaces, RBAC, Tasks, Subtasks, Attachments, Notifications, and Audit Logs.
 * Fulfills all requirements across Team #4 (Chetana, Rudra, Gagan, Harsh).
 */
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000; // REQ-1.3
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // REQ-2.2: invitation links expire after 7 days

class Database {
  constructor() {
    this.PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MS;
    this.INVITATION_TTL_MS = INVITATION_TTL_MS;
    this.resetData();
  }

  resetData() {
    this.users = new Map();
    this.workspaces = new Map();
    this.memberships = new Map();
    this.tasks = new Map();
    this.subtasks = new Map();
    this.attachments = new Map();
    this.tags = new Map();
    this.notifications = new Map();
    this.auditLogs = [];
    this.passwordResets = new Map();
    this.invitations = new Map();
  }

  reset() {
    this.resetData();
    this.autoPersist = false;
    this.storageFilePath = null;
    this.backupDirPath = null;
    this.stopDailyBackups();
  }

  // --- Auth & User Store ---
  createUser({ email, password_hash, full_name }) {
    const userId = crypto.randomUUID();
    const user = {
      user_id: userId,
      email: email.toLowerCase(),
      password_hash,
      full_name,
      created_at: new Date().toISOString()
    };
    this.users.set(userId, user); this._persistIfEnabled();
    return { ...user };
  }

  /** Fills in the name and password of an account that only existed as an invitation stub. */
  activateUser(userId, { full_name, password_hash }) {
    const user = this.users.get(userId);
    if (!user) return null;
    const updated = { ...user, full_name, password_hash };
    this.users.set(userId, updated); this._persistIfEnabled();
    return { ...updated };
  }

  findUserByEmail(email) {
    if (!email) return null;
    const lower = email.toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === lower) return { ...u };
    }
    return null;
  }

  getUser(userId) {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  updateUserPassword(email, newHash) {
    const user = this.findUserByEmail(email);
    if (!user) return false;
    user.password_hash = newHash;
    this.users.set(user.user_id, user); this._persistIfEnabled();
    return true;
  }

  createPasswordResetToken(email) {
    const lower = email.toLowerCase();
    const now = Date.now();

    // Drop expired tokens and any earlier token for this account: only the newest one works.
    for (const [existing, entry] of this.passwordResets.entries()) {
      if (entry.email === lower || Date.parse(entry.expires_at) <= now) {
        this.passwordResets.delete(existing);
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(now + PASSWORD_RESET_TTL_MS).toISOString(); // 15 mins expiry per REQ-1.3
    this.passwordResets.set(token, { email: lower, expires_at });
    this._persistIfEnabled();
    return token;
  }

  verifyPasswordResetToken(token) {
    const entry = this.passwordResets.get(token);
    if (!entry) return null;
    if (Date.now() >= Date.parse(entry.expires_at)) {
      this.passwordResets.delete(token);
      return null;
    }
    return entry.email;
  }

  consumePasswordResetToken(token) {
    this.passwordResets.delete(token);
    this._persistIfEnabled();
  }

  // --- Workspace & RBAC Store ---
  createWorkspace({ title, description, owner_id }) {
    const workspaceId = crypto.randomUUID();
    const workspace = {
      workspace_id: workspaceId,
      title,
      description: description || '',
      owner_id,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.workspaces.set(workspaceId, workspace); this._persistIfEnabled();

    // Automatically assign owner as Admin
    this.addMembership({
      workspace_id: workspaceId,
      user_id: owner_id,
      role: 'Admin'
    });

    return { ...workspace };
  }

  getWorkspace(workspaceId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws || ws.is_archived) return null;
    return { ...ws };
  }

  listWorkspacesForUser(userId) {
    if (!userId) return [];

    const results = [];

    for (const membership of this.memberships.values()) {
      if (membership.user_id !== userId) continue;

      const workspace = this.getWorkspace(membership.workspace_id);
      if (!workspace) continue;

      results.push({
        ...workspace,
        role: membership.role
      });
    }

    return results;
  }
  updateWorkspace(workspaceId, updates) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws || ws.is_archived) return null;
    const updated = {
      ...ws,
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.workspaces.set(workspaceId, updated);
    return { ...updated };
  }

  deleteWorkspace(workspaceId) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return false;

    // Business Rule 2: Deletion of workspace automatically soft-deletes all associated tasks, subtasks, files
    ws.is_archived = true;
    ws.deleted_at = new Date().toISOString();
    this.workspaces.set(workspaceId, ws);

    for (const task of this.tasks.values()) {
      if (task.workspace_id === workspaceId) {
        this.archiveTask(task.task_id);
      }
    }
    return true;
  }

  addMembership({ workspace_id, user_id, role = 'Member' }) {
    const existing = this.getMembership(workspace_id, user_id);
    if (existing) {
      existing.role = role;
      this.memberships.set(existing.membership_id, existing);
      return { ...existing };
    }

    const membershipId = crypto.randomUUID();
    const membership = {
      membership_id: membershipId,
      workspace_id,
      user_id,
      role, // 'Admin', 'Member', 'Viewer'
      joined_at: new Date().toISOString()
    };
    this.memberships.set(membershipId, membership); this._persistIfEnabled();
    return { ...membership };
  }

  getMembership(workspace_id, user_id) {
    for (const m of this.memberships.values()) {
      if (m.workspace_id === workspace_id && m.user_id === user_id) {
        return { ...m };
      }
    }
    return null;
  }

  listWorkspaceMembers(workspace_id) {
    const members = [];
    for (const m of this.memberships.values()) {
      if (m.workspace_id === workspace_id) {
        const u = this.getUser(m.user_id);
        members.push({
          ...m,
          user: u ? { user_id: u.user_id, full_name: u.full_name, email: u.email } : null
        });
      }
    }
    return members;
  }

  removeMembership(workspace_id, user_id) {
    for (const [id, m] of this.memberships.entries()) {
      if (m.workspace_id === workspace_id && m.user_id === user_id) {
        this.memberships.delete(id);
        this._persistIfEnabled();
        return true;
      }
    }
    return false;
  }

  // --- Workspace Invitations (REQ-2.2) ---
  // Only a SHA-256 hash of each invitation token is stored; the token itself exists only in the email.
  _hashInvitationToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  /**
   * Creates a pending invitation and returns it together with the one-time token.
   * An earlier pending invitation for the same workspace and email is revoked.
   */
  createInvitation({ workspace_id, email, role, invited_by }) {
    const lower = email.toLowerCase();
    const now = new Date();

    for (const inv of this.invitations.values()) {
      if (inv.workspace_id === workspace_id && inv.email === lower && inv.status === 'Pending') {
        inv.status = 'Revoked';
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const invitation = {
      invitation_id: crypto.randomUUID(),
      workspace_id,
      email: lower,
      role,
      invited_by,
      token_hash: this._hashInvitationToken(token),
      status: 'Pending', // 'Pending', 'Accepted', 'Revoked'
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
      accepted_at: null
    };
    this.invitations.set(invitation.invitation_id, invitation); this._persistIfEnabled();
    return { invitation: this._publicInvitation(invitation), token };
  }

  _publicInvitation(invitation) {
    const { token_hash, ...rest } = invitation; // eslint-disable-line no-unused-vars
    return { ...rest };
  }

  /** Returns the invitation for a token whatever its state, or null if no invitation matches. */
  findInvitationByToken(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const hash = this._hashInvitationToken(token);
    for (const inv of this.invitations.values()) {
      if (inv.token_hash === hash) return this._publicInvitation(inv);
    }
    return null;
  }

  isInvitationUsable(invitation) {
    return Boolean(invitation) &&
      invitation.status === 'Pending' &&
      Date.now() < Date.parse(invitation.expires_at);
  }

  markInvitationAccepted(invitationId) {
    const inv = this.invitations.get(invitationId);
    if (!inv || inv.status !== 'Pending') return false;
    inv.status = 'Accepted';
    inv.accepted_at = new Date().toISOString();
    this._persistIfEnabled();
    return true;
  }

  countWorkspaceAdmins(workspace_id) {
    let count = 0;
    for (const m of this.memberships.values()) {
      if (m.workspace_id === workspace_id && m.role === 'Admin') count++;
    }
    return count;
  }

  /** Takes a user off every task of a workspace (Business Rule 1: assignees must be members). */
  unassignUserFromWorkspaceTasks(workspace_id, user_id) {
    let changed = 0;
    for (const task of this.tasks.values()) {
      if (task.workspace_id !== workspace_id || !Array.isArray(task.assignees)) continue;
      if (!task.assignees.includes(user_id)) continue;
      task.assignees = task.assignees.filter(id => id !== user_id);
      changed++;
    }
    if (changed > 0) this._persistIfEnabled();
    return changed;
  }

  // --- Task CRUD Store ---
  createTask(taskData) {
    const taskId = taskData.task_id || crypto.randomUUID();
    const task = {
      task_id: taskId,
      workspace_id: taskData.workspace_id,
      title: taskData.title,
      description: taskData.description || '',
      priority: taskData.priority, // 'Low', 'Medium', 'High'
      status: taskData.status || 'To-Do', // 'To-Do', 'In-Progress', 'Review', 'Done'
      due_date: taskData.due_date || null,
      created_by: taskData.created_by,
      assignees: Array.isArray(taskData.assignees) ? taskData.assignees : (taskData.assignee_id ? [taskData.assignee_id] : []),
      tags: Array.isArray(taskData.tags) ? taskData.tags : [],
      progress_percentage: 0,
      is_archived: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.tasks.set(taskId, task); this._persistIfEnabled();
    return { ...task };
  }

  getTask(taskId, includeArchived = false) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.is_archived && !includeArchived) return null;
    return { ...task };
  }

  findTasks(filterFn, includeArchived = false) {
    const results = [];
    for (const task of this.tasks.values()) {
      if (!includeArchived && task.is_archived) continue;
      if (!filterFn || filterFn(task)) {
        results.push({ ...task });
      }
    }
    return results;
  }

  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const updatedTask = {
      ...task,
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.tasks.set(taskId, updatedTask); this._persistIfEnabled();
    return { ...updatedTask };
  }

  archiveTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const now = new Date().toISOString();
    task.is_archived = true;
    task.deleted_at = now;
    task.updated_at = now;

    // Atomically cascade soft-delete to subtasks & attachments
    for (const subtask of this.subtasks.values()) {
      if (subtask.task_id === taskId) {
        subtask.is_archived = true;
        subtask.deleted_at = now;
      }
    }

    for (const attachment of this.attachments.values()) {
      if (attachment.task_id === taskId) {
        attachment.is_archived = true;
        attachment.deleted_at = now;
      }
    }
    this._persistIfEnabled();
    return true;
  }

  deleteTaskPermanently(taskId) {
    if (!this.tasks.has(taskId)) return false;

    for (const [subtaskId, subtask] of this.subtasks.entries()) {
      if (subtask.task_id === taskId) this.subtasks.delete(subtaskId);
    }
    for (const [attachmentId, attachment] of this.attachments.entries()) {
      if (attachment.task_id === taskId) this.attachments.delete(attachmentId);
    }
    this.tasks.delete(taskId); this._persistIfEnabled();
    return true;
  }

  // --- Subtask Store ---
  createSubtask(subtaskData) {
    const subtaskId = subtaskData.subtask_id || crypto.randomUUID();
    const taskSubtasks = this.getSubtasksByTaskId(subtaskData.task_id);
    const orderIndex = subtaskData.order_index !== undefined ? subtaskData.order_index : taskSubtasks.length;

    const subtask = {
      subtask_id: subtaskId,
      task_id: subtaskData.task_id,
      title: subtaskData.title,
      is_completed: Boolean(subtaskData.is_completed),
      order_index: orderIndex,
      is_archived: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.subtasks.set(subtaskId, subtask); this._persistIfEnabled();
    this.recalculateTaskProgress(subtaskData.task_id);
    return { ...subtask };
  }

  getSubtask(subtaskId) {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask || subtask.is_archived) return null;
    return { ...subtask };
  }

  getSubtasksByTaskId(taskId, includeArchived = false) {
    const results = [];
    for (const subtask of this.subtasks.values()) {
      if (subtask.task_id === taskId) {
        if (!includeArchived && subtask.is_archived) continue;
        results.push({ ...subtask });
      }
    }
    return results.sort((a, b) => a.order_index - b.order_index);
  }

  updateSubtask(subtaskId, updates) {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask) return null;

    const updated = {
      ...subtask,
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.subtasks.set(subtaskId, updated);
    this.recalculateTaskProgress(subtask.task_id);
    return { ...updated };
  }

  deleteSubtask(subtaskId) {
    const subtask = this.subtasks.get(subtaskId);
    if (!subtask) return false;

    const taskId = subtask.task_id;
    this.subtasks.delete(subtaskId);

    const remaining = this.getSubtasksByTaskId(taskId);
    remaining.forEach((item, idx) => {
      item.order_index = idx;
      this.subtasks.set(item.subtask_id, item);
    });

    this.recalculateTaskProgress(taskId);
    return true;
  }

  reorderSubtasks(taskId, orderedSubtaskIds) {
    const currentSubtasks = this.getSubtasksByTaskId(taskId);
    const subtaskMap = new Map(currentSubtasks.map(s => [s.subtask_id, s]));

    orderedSubtaskIds.forEach((id, newIndex) => {
      if (subtaskMap.has(id)) {
        const item = subtaskMap.get(id);
        item.order_index = newIndex;
        item.updated_at = new Date().toISOString();
        this.subtasks.set(id, item);
      }
    });
    return this.getSubtasksByTaskId(taskId);
  }

  recalculateTaskProgress(taskId) {
    const subtasks = this.getSubtasksByTaskId(taskId);
    if (subtasks.length === 0) {
      this.updateTask(taskId, { progress_percentage: 0 });
      return 0;
    }
    const completed = subtasks.filter(s => s.is_completed).length;
    const progress = Math.round((completed / subtasks.length) * 100);
    this.updateTask(taskId, { progress_percentage: progress });
    return progress;
  }

  // --- Attachments ---
  createAttachment(attachmentData) {
    const attachmentId = attachmentData.attachment_id || crypto.randomUUID();
    const uploadedAt = attachmentData.uploaded_at || new Date().toISOString();
    const expiresAt = attachmentData.expires_at || new Date(new Date(uploadedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const attachment = {
      attachment_id: attachmentId,
      task_id: attachmentData.task_id,
      file_name: attachmentData.file_name,
      file_size: attachmentData.file_size,
      mime_type: attachmentData.mime_type,
      storage_path: attachmentData.storage_path,
      download_token: attachmentData.download_token || crypto.randomBytes(24).toString('hex'),
      uploaded_by: attachmentData.uploaded_by,
      is_archived: false,
      deleted_at: null,
      uploaded_at: uploadedAt,
      expires_at: expiresAt
    };
    this.attachments.set(attachmentId, attachment); this._persistIfEnabled();
    return { ...attachment };
  }

  getAttachment(attachmentId) {
    const att = this.attachments.get(attachmentId);
    if (!att || att.is_archived) return null;
    return { ...att };
  }

  getAttachmentsByTaskId(taskId, includeArchived = false) {
    const results = [];
    for (const att of this.attachments.values()) {
      if (att.task_id === taskId) {
        if (!includeArchived && att.is_archived) continue;
        results.push({ ...att });
      }
    }
    return results;
  }

  // --- Notifications (Feature 8) ---
  createNotification({ user_id, title, message, type = 'INFO', target_entity_id = null }) {
    const notifId = crypto.randomUUID();
    const notif = {
      notification_id: notifId,
      user_id,
      title,
      message,
      type, // 'ASSIGNMENT', 'DEADLINE', 'STATUS_CHANGE', 'COMMENT'
      target_entity_id,
      is_read: false,
      created_at: new Date().toISOString()
    };
    this.notifications.set(notifId, notif);
    return { ...notif };
  }

  getNotificationsForUser(userId) {
    const list = [];
    for (const n of this.notifications.values()) {
      if (n.user_id === userId) list.push({ ...n });
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  markNotificationAsRead(notifId) {
    const n = this.notifications.get(notifId);
    if (!n) return false;
    n.is_read = true;
    this.notifications.set(notifId, n);
    return true;
  }

  // --- Audit Log (Feature 8: REQ-8.3 Immutable Timeline) ---
  logAuditEvent({ workspace_id, actor_id, action, target_entity, target_id, details = {} }) {
    const immutableDetails = deepFreeze(JSON.parse(JSON.stringify(details)));
    const entry = {
      log_id: crypto.randomUUID(),
      workspace_id,
      actor_id,
      action, // e.g. 'TASK_CREATED', 'STATUS_UPDATED', 'MEMBER_INVITED'
      target_entity, // 'TASK', 'SUBTASK', 'WORKSPACE', 'ATTACHMENT'
      target_id,
      details: immutableDetails,
      timestamp: new Date().toISOString()
    };
    // Append-only freeze
    Object.freeze(entry);
    this.auditLogs.push(entry);
    return entry;
  }

  getAuditLogs(workspace_id) {
    return this.auditLogs
      .filter(log => !workspace_id || log.workspace_id === workspace_id)
      .map(log => ({
        ...log,
        details: { ...log.details }
      }));
  }

  // --- Persistence & Backup Services (REQ-NFR-3, SRS 2.4) ---
  serialize() {
    return JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      users: Array.from(this.users.entries()),
      workspaces: Array.from(this.workspaces.entries()),
      memberships: Array.from(this.memberships.entries()),
      tasks: Array.from(this.tasks.entries()),
      subtasks: Array.from(this.subtasks.entries()),
      attachments: Array.from(this.attachments.entries()),
      tags: Array.from(this.tags.entries()),
      notifications: Array.from(this.notifications.entries()),
      auditLogs: this.auditLogs,
      passwordResets: Array.from(this.passwordResets.entries()),
      invitations: Array.from(this.invitations.entries())
    }, null, 2);
  }

  deserialize(jsonString) {
    const data = JSON.parse(jsonString);
    this.resetData();
    if (Array.isArray(data.users)) this.users = new Map(data.users);
    if (Array.isArray(data.workspaces)) this.workspaces = new Map(data.workspaces);
    if (Array.isArray(data.memberships)) this.memberships = new Map(data.memberships);
    if (Array.isArray(data.tasks)) this.tasks = new Map(data.tasks);
    if (Array.isArray(data.subtasks)) this.subtasks = new Map(data.subtasks);
    if (Array.isArray(data.attachments)) this.attachments = new Map(data.attachments);
    if (Array.isArray(data.tags)) this.tags = new Map(data.tags);
    if (Array.isArray(data.notifications)) this.notifications = new Map(data.notifications);
    if (Array.isArray(data.auditLogs)) this.auditLogs = data.auditLogs;
    if (Array.isArray(data.passwordResets)) this.passwordResets = new Map(data.passwordResets);
    if (Array.isArray(data.invitations)) this.invitations = new Map(data.invitations);
  }

  save(customPath = this.storageFilePath) {
    if (!customPath) return false;
    const dir = path.dirname(customPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${customPath}.${crypto.randomUUID()}.tmp`;
    const payload = this.serialize();
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, customPath);
    return true;
  }

  load(customPath = this.storageFilePath) {
    if (!customPath || !fs.existsSync(customPath)) return false;
    const content = fs.readFileSync(customPath, 'utf8');
    this.deserialize(content);
    return true;
  }

  enableAutoPersist(filePath) {
    this.storageFilePath = filePath || path.join(__dirname, '../../data/database.json');
    this.autoPersist = true;
    if (fs.existsSync(this.storageFilePath)) {
      this.load(this.storageFilePath);
    }
  }

  disableAutoPersist() {
    this.autoPersist = false;
    this.storageFilePath = null;
  }

  _persistIfEnabled() {
    if (this.autoPersist && this.storageFilePath) {
      this.save(this.storageFilePath);
    }
  }

  backup(targetDir = this.backupDirPath) {
    const backupDir = targetDir || path.join(__dirname, '../../data/backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().split('T')[0];
    const backupFile = path.join(backupDir, `backup-${dateStr}.json`);
    const tempPath = `${backupFile}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, this.serialize(), 'utf8');
    fs.renameSync(tempPath, backupFile);
    return backupFile;
  }

  startDailyBackups(intervalMs = 24 * 60 * 60 * 1000, targetDir) {
    this.backupDirPath = targetDir || path.join(__dirname, '../../data/backups');
    this.backup(this.backupDirPath);
    if (!this._backupTimer) {
      this._backupTimer = setInterval(() => {
        try {
          this.backup(this.backupDirPath);
        } catch (err) {
          console.error('[Database Backup Error]', err);
        }
      }, intervalMs);
      if (this._backupTimer.unref) this._backupTimer.unref();
    }
  }

  stopDailyBackups() {
    if (this._backupTimer) {
      clearInterval(this._backupTimer);
      this._backupTimer = null;
    }
  }
}

const db = new Database();
module.exports = { Database, db };
