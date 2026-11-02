const { db } = require('../models/Database');
const rbacService = require('./rbacService');
const realtimeService = require('./realtimeService');

/**
 * Kanban Drag & Drop Engine and Collaborator Assignment Service
 * Owner: Gagan B Sasalatti | PES1UG24CS164
 * Feature 5 — Task Assignment & Kanban Workflow Engine
 * REQ-5.1, REQ-5.2, REQ-5.3 | ARC-KANBAN | DSN-05
 */

const KANBAN_COLUMNS = ['To-Do', 'In-Progress', 'Review', 'Done'];

class TaskDragDropService {
  /**
   * REQ-5.1 (Collaborator Assignment & Business Rule 1):
   * Assigns one or more workspace members to a task with avatar indicators.
   * Business Rule 1: A user cannot be assigned to a task in a workspace they are not currently a member of.
   */
  assignCollaborators(taskId, userIds, actorId) {
    const task = db.getTask(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' was not found.`);
    }

    if (!Array.isArray(userIds)) {
      throw new Error('userIds must be an array.');
    }

    // Enforce Business Rule 1
    for (const uid of userIds) {
      const isMember = rbacService.isMember(task.workspace_id, uid);
      if (!isMember) {
        throw new Error(`Business Rule 1 Violation: User '${uid}' is not a member of workspace '${task.workspace_id}'.`);
      }
    }

    const updated = db.updateTask(taskId, { assignees: userIds });

    // Trigger Notification for assigned users
    for (const uid of userIds) {
      db.createNotification({
        user_id: uid,
        title: 'Task Assigned',
        message: `You were assigned to task: ${task.title}`,
        type: 'ASSIGNMENT',
        target_entity_id: taskId
      });
    }

    // Trigger Audit Log
    db.logAuditEvent({
      workspace_id: task.workspace_id,
      actor_id: actorId,
      action: 'COLLABORATOR_ASSIGNED',
      target_entity: 'TASK',
      target_id: taskId,
      details: { assignees: userIds }
    });

    return updated;
  }

  /**
   * REQ-5.2 (Interactive Kanban Board Columns):
   * Groups active tasks into the 4 canonical Kanban workflow stages:
   * To-Do, In-Progress, Review, and Done.
   */
  getKanbanBoard(workspaceId) {
    const allTasks = db.findTasks(t => t.workspace_id === workspaceId);

    const board = {
      'To-Do': [],
      'In-Progress': [],
      'Review': [],
      'Done': []
    };

    allTasks.forEach(task => {
      const col = task.status;
      if (board[col]) {
        // Hydrate avatar indicators for assignees
        const hydratedAssignees = (task.assignees || []).map(uid => {
          const user = db.getUser(uid);
          return user
            ? { user_id: uid, name: user.full_name, initials: user.full_name.split(' ').map(n => n[0]).join('').toUpperCase() }
            : { user_id: uid, name: 'Unknown', initials: '?' };
        });

        board[col].push({
          ...task,
          assignee_avatars: hydratedAssignees
        });
      }
    });

    return board;
  }

  /**
   * REQ-5.3 (Drag-and-Drop State Sync):
   * Executes smooth state transitions between columns, optimistic sync, and status audit logs.
   */
  moveCard(taskId, targetColumn, actorId) {
    if (!KANBAN_COLUMNS.includes(targetColumn)) {
      throw new Error(`Invalid Kanban column: '${targetColumn}'. Must be one of: ${KANBAN_COLUMNS.join(', ')}.`);
    }

    const task = db.getTask(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' was not found.`);
    }

    const previousStatus = task.status;
    if (previousStatus === targetColumn) {
      return { task, transitioned: false };
    }

    const updatedTask = db.updateTask(taskId, { status: targetColumn });

    // Broadcast to other viewers of this workspace and write the audit log (REQ-5.3 & REQ-8.3)
    realtimeService.publish(task.workspace_id, 'task.moved', {
      task_id: taskId,
      from: previousStatus,
      to: targetColumn,
      actor_id: actorId,
      task: updatedTask
    });
    db.logAuditEvent({
      workspace_id: task.workspace_id,
      actor_id: actorId,
      action: 'KANBAN_STATUS_TRANSITION',
      target_entity: 'TASK',
      target_id: taskId,
      details: { from: previousStatus, to: targetColumn }
    });

    // Notify assignees about status change
    (task.assignees || []).forEach(assigneeId => {
      if (assigneeId !== actorId) {
        db.createNotification({
          user_id: assigneeId,
          title: 'Task Status Updated',
          message: `Task '${task.title}' moved from '${previousStatus}' to '${targetColumn}'.`,
          type: 'STATUS_CHANGE',
          target_entity_id: taskId
        });
      }
    });

    return {
      task: updatedTask,
      transitioned: true,
      previous_status: previousStatus,
      new_status: targetColumn
    };
  }
}

module.exports = new TaskDragDropService();
