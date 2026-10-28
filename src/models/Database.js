const crypto = require('crypto');

/**
 * Enterprise Transactional Database Store for Task Manager Application
 * Supports Multi-tenant Workspaces, RBAC, Tasks, Subtasks, Attachments, Notifications, and Audit Logs.
 * Fulfills all requirements across Team #4 (Chetana, Rudra, Gagan, Harsh).
 */
class Database {
  constructor() {
    this.reset();
  }

  reset() {
    this.users = new Map(); // userId -> user
    this.workspaces = new Map(); // workspaceId -> workspace
    this.memberships = new Map(); // membershipId -> membership
    this.tasks = new Map(); // taskId -> task
    this.subtasks = new Map(); // subtaskId -> subtask
    this.attachments = new Map(); // attachmentId -> attachment
    this.tags = new Map(); // tagId -> tag
    this.notifications = new Map(); // notifId -> notification
    this.auditLogs = []; // Array of immutable audit log entries
    this.passwordResets = new Map(); // token -> { email, expires_at }
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
    this.users.set(userId, user);
    return { ...user };
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
    this.users.set(user.user_id, user);
    return true;
  }

  createPasswordResetToken(email) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry per REQ-1.3
    this.passwordResets.set(token, { email: email.toLowerCase(), expires_at });
    return token;
  }

  verifyPasswordResetToken(token) {
    const entry = this.passwordResets.get(token);
    if (!entry) return null;
    if (new Date() > new Date(entry.expires_at)) {
      this.passwordResets.delete(token);
      return null;
    }
    return entry.email;
  }

  consumePasswordResetToken(token) {
    this.passwordResets.delete(token);
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
    this.workspaces.set(workspaceId, workspace);

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
    this.memberships.set(membershipId, membership);
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
        return true;
      }
    }
    return false;
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
    this.tasks.set(taskId, task);
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
    this.tasks.set(taskId, updatedTask);
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
    this.tasks.delete(taskId);
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

    this.subtasks.set(subtaskId, subtask);
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
      uploaded_at: new Date().toISOString()
    };
    this.attachments.set(attachmentId, attachment);
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
    const entry = {
      log_id: crypto.randomUUID(),
      workspace_id,
      actor_id,
      action, // e.g. 'TASK_CREATED', 'STATUS_UPDATED', 'MEMBER_INVITED'
      target_entity, // 'TASK', 'SUBTASK', 'WORKSPACE', 'ATTACHMENT'
      target_id,
      details,
      timestamp: new Date().toISOString()
    };
    // Append-only freeze
    Object.freeze(entry);
    this.auditLogs.push(entry);
    return entry;
  }

  getAuditLogs(workspace_id) {
    return this.auditLogs.filter(log => !workspace_id || log.workspace_id === workspace_id);
  }
}

const db = new Database();
module.exports = { Database, db };
