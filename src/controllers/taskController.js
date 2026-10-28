/**
 * Feature 3: Task Lifecycle & Core CRUD Operations
 * Implemented by: Dhadhal Rudra (PES1UG24CS146) | Team #4 (Section C)
 * Requirements: REQ-3.1, REQ-3.2, REQ-3.3
 */
const { db } = require('../models/Database');
const auditLogger = require('../services/auditLogger');
const {
  sanitizeString,
  validateTaskCreation,
  validateTaskUpdate
} = require('../middleware/validationMiddleware');

/**
 * Task Controller (Owner: Dhadhal Rudra | PES1UG24CS146)
 * Implements Feature 3: Task Lifecycle & Core CRUD Operations (REQ-3.1, REQ-3.2, REQ-3.3)
 * Architectural Reference: ARC-TASK | Design Reference: DSN-03
 * Qualitative Property: Data Integrity & Consistency
 */
class TaskController {
  /**
   * REQ-3.1 (Task Creation & Validation):
   * Enables authorized members to create tasks with title, description, due date, and priority.
   * Enforces Business Rule 3 (no past due dates) and Table B.1 schema constraints.
   */
  async createTask(req, res) {
    try {
      const { isValid, errors } = validateTaskCreation(req.body);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: errors
        });
      }

      const taskData = {
        workspace_id: req.body.workspace_id,
        title: sanitizeString(req.body.title),
        description: sanitizeString(req.body.description || ''),
        priority: req.body.priority,
        status: req.body.status || 'To-Do',
        due_date: req.body.due_date || null,
        created_by: req.body.created_by,
        assignees: Array.isArray(req.body.assignees)
          ? req.body.assignees
          : (req.body.assignee_id ? [req.body.assignee_id] : []),
        tags: Array.isArray(req.body.tags) ? req.body.tags.map(sanitizeString) : []
      };

      const newTask = db.createTask(taskData);

      // Audit Log Entry (REQ-8.3)
      auditLogger.log({
        workspaceId: newTask.workspace_id,
        actorId: newTask.created_by,
        action: 'TASK_CREATED',
        targetEntity: 'TASK',
        targetId: newTask.task_id,
        details: { title: newTask.title, priority: newTask.priority }
      });

      return res.status(201).json({
        success: true,
        message: 'Task created successfully',
        data: newTask
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }

  /**
   * Retrieve single task details with aggregated subtasks and attachment metadata
   */
  async getTaskById(req, res) {
    try {
      const { taskId } = req.params;
      const includeArchived = req.query.includeArchived === 'true';

      const task = db.getTask(taskId, includeArchived);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Task with id '${taskId}' was not found.`
        });
      }

      const subtasks = db.getSubtasksByTaskId(taskId, includeArchived);
      const attachments = db.getAttachmentsByTaskId(taskId, includeArchived);

      return res.status(200).json({
        success: true,
        data: {
          ...task,
          subtasks,
          attachments
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }

  /**
   * List tasks within a workspace with optional status/priority/assignee filtering
   */
  async listTasks(req, res) {
    try {
      const { workspace_id, status, priority, assignee_id, includeArchived } = req.query;

      const shouldIncludeArchived = includeArchived === 'true';
      const tasks = db.findTasks((t) => {
        if (workspace_id && t.workspace_id !== workspace_id) return false;
        if (status && t.status !== status) return false;
        if (priority && t.priority !== priority) return false;
        if (assignee_id && !(t.assignees || []).includes(assignee_id)) return false;
        return true;
      }, shouldIncludeArchived);

      return res.status(200).json({
        success: true,
        count: tasks.length,
        data: tasks
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }

  /**
   * REQ-3.2 (Task Modification):
   * Allows editing task parameters and dynamically recording modification timestamps (updated_at).
   */
  async updateTask(req, res) {
    try {
      const { taskId } = req.params;
      const existingTask = db.getTask(taskId);

      if (!existingTask) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Task with id '${taskId}' was not found.`
        });
      }

      const { isValid, errors } = validateTaskUpdate(req.body);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: errors
        });
      }

      const updates = {};
      if (req.body.title !== undefined) updates.title = sanitizeString(req.body.title);
      if (req.body.description !== undefined) updates.description = sanitizeString(req.body.description);
      if (req.body.priority !== undefined) updates.priority = req.body.priority;
      if (req.body.status !== undefined) updates.status = req.body.status;
      if (req.body.due_date !== undefined) updates.due_date = req.body.due_date;
      if (req.body.assignees !== undefined && Array.isArray(req.body.assignees)) {
        updates.assignees = req.body.assignees;
      } else if (req.body.assignee_id !== undefined) {
        updates.assignees = [req.body.assignee_id];
      }
      if (req.body.tags !== undefined && Array.isArray(req.body.tags)) {
        updates.tags = req.body.tags.map(sanitizeString);
      }

      const updatedTask = db.updateTask(taskId, updates);

      // Audit Log Entry
      auditLogger.log({
        workspaceId: updatedTask.workspace_id,
        actorId: req.user ? req.user.userId : 'USER',
        action: 'TASK_UPDATED',
        targetEntity: 'TASK',
        targetId: taskId,
        details: updates
      });

      return res.status(200).json({
        success: true,
        message: 'Task updated successfully',
        data: updatedTask
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }

  /**
   * REQ-3.3 (Task Archiving - Soft Deletion):
   * Soft-deletes (archives) task, cascading updates to child subtasks atomically.
   */
  async archiveTask(req, res) {
    try {
      const { taskId } = req.params;
      const existingTask = db.getTask(taskId);

      if (!existingTask) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Task with id '${taskId}' was not found.`
        });
      }

      const success = db.archiveTask(taskId);
      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to archive task.'
        });
      }

      auditLogger.log({
        workspaceId: existingTask.workspace_id,
        actorId: req.user ? req.user.userId : 'USER',
        action: 'TASK_ARCHIVED',
        targetEntity: 'TASK',
        targetId: taskId,
        details: { title: existingTask.title }
      });

      return res.status(200).json({
        success: true,
        message: 'Task and all associated subtasks archived (soft-deleted) successfully.'
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }

  /**
   * REQ-3.3 & REQ-NFR-3 (Permanent Deletion & Safety Requirements):
   * Cascading atomic deletion of task and child subtasks. Requires explicit user confirmation.
   */
  async deleteTaskPermanently(req, res) {
    try {
      const { taskId } = req.params;
      const { confirm } = req.body;

      if (confirm !== true) {
        return res.status(400).json({
          success: false,
          error: 'Safety Confirmation Required',
          message: 'Critical permanent deletion requires explicit confirmation parameter {"confirm": true}.'
        });
      }

      const existingTask = db.getTask(taskId, true);
      if (!existingTask) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Task with id '${taskId}' was not found.`
        });
      }

      const success = db.deleteTaskPermanently(taskId);
      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to permanently delete task.'
        });
      }

      auditLogger.log({
        workspaceId: existingTask.workspace_id,
        actorId: req.user ? req.user.userId : 'USER',
        action: 'TASK_PERMANENTLY_DELETED',
        targetEntity: 'TASK',
        targetId: taskId,
        details: { title: existingTask.title }
      });

      return res.status(200).json({
        success: true,
        message: 'Task and all child subtasks and attachments permanently deleted.'
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }
}

module.exports = new TaskController();
