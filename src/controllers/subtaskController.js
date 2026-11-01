const { db } = require('../models/Database');
const { sanitizeString } = require('../middleware/validationMiddleware');
const auditLogger = require('../services/auditLogger');

function logSubtaskEvent(req, task, action, targetId, details) {
  auditLogger.log({
    workspaceId: task.workspace_id,
    actorId: req.user ? req.user.userId : 'USER',
    action,
    targetEntity: 'SUBTASK',
    targetId,
    details
  });
}

/**
 * Subtask Controller (Owner: Dhadhal Rudra | PES1UG24CS146)
 * Implements Feature 4: Subtasks, Checklists & Attachment Handling (REQ-4.1, REQ-4.2)
 * Architectural Reference: ARC-TASK | Design Reference: DSN-04
 */
class SubtaskController {
  /**
   * REQ-4.1: Add subtask item under parent task
   * REQ-4.2: Triggers automatic progress percentage recalculation
   */
  async addSubtask(req, res) {
    try {
      const { taskId } = req.params;
      const { title, order_index } = req.body;

      const parentTask = db.getTask(taskId);
      if (!parentTask) {
        return res.status(404).json({
          success: false,
          error: 'Parent Task Not Found',
          message: `Cannot add subtask: Task '${taskId}' does not exist or is archived.`
        });
      }

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Subtask title is required and cannot be empty.'
        });
      }

      const subtask = db.createSubtask({
        task_id: taskId,
        title: sanitizeString(title),
        order_index: typeof order_index === 'number' ? order_index : undefined,
        is_completed: false
      });

      const updatedTask = db.getTask(taskId);
      logSubtaskEvent(req, parentTask, 'SUBTASK_CREATED', subtask.subtask_id, { task_id: taskId, title: subtask.title });

      return res.status(201).json({
        success: true,
        message: 'Subtask created successfully',
        data: {
          subtask,
          task_progress_percentage: updatedTask.progress_percentage
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
   * List all subtasks for a task ordered by index
   */
  async listSubtasks(req, res) {
    try {
      const { taskId } = req.params;
      const parentTask = db.getTask(taskId);
      if (!parentTask) {
        return res.status(404).json({
          success: false,
          error: 'Parent Task Not Found',
          message: `Task '${taskId}' does not exist or is archived.`
        });
      }

      const subtasks = db.getSubtasksByTaskId(taskId);
      return res.status(200).json({
        success: true,
        count: subtasks.length,
        task_progress_percentage: parentTask.progress_percentage,
        data: subtasks
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
   * REQ-4.1 & REQ-4.2: Toggle completion (check / uncheck) and update title
   */
  async updateSubtask(req, res) {
    try {
      const { subtaskId } = req.params;
      const existing = db.getSubtask(subtaskId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Subtask '${subtaskId}' was not found.`
        });
      }

      const updates = {};
      if (req.body.title !== undefined) {
        if (typeof req.body.title !== 'string' || req.body.title.trim().length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Validation Error',
            message: 'Subtask title cannot be empty.'
          });
        }
        updates.title = sanitizeString(req.body.title);
      }

      if (req.body.is_completed !== undefined) {
        updates.is_completed = Boolean(req.body.is_completed);
      }

      const updated = db.updateSubtask(subtaskId, updates);
      const parentTask = db.getTask(existing.task_id);
      if (parentTask) {
        logSubtaskEvent(req, parentTask, 'SUBTASK_UPDATED', subtaskId, { task_id: existing.task_id, ...updates });
      }

      return res.status(200).json({
        success: true,
        message: 'Subtask updated successfully',
        data: {
          subtask: updated,
          task_progress_percentage: parentTask ? parentTask.progress_percentage : 0
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
   * REQ-4.1: Reorder subtasks under a parent task
   */
  async reorderSubtasks(req, res) {
    try {
      const { taskId } = req.params;
      const { orderedSubtaskIds } = req.body;

      if (!Array.isArray(orderedSubtaskIds)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'orderedSubtaskIds must be an array of subtask IDs in their desired order.'
        });
      }

      const reordered = db.reorderSubtasks(taskId, orderedSubtaskIds);
      const parentTask = db.getTask(taskId);
      if (parentTask) {
        logSubtaskEvent(req, parentTask, 'SUBTASKS_REORDERED', taskId, { task_id: taskId, ordered_subtask_ids: orderedSubtaskIds });
      }
      return res.status(200).json({
        success: true,
        message: 'Subtasks reordered successfully',
        data: reordered
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
   * REQ-4.1 & REQ-4.2: Delete a subtask checklist item and recalculate progress percentage
   */
  async deleteSubtask(req, res) {
    try {
      const { subtaskId } = req.params;
      const existing = db.getSubtask(subtaskId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Subtask '${subtaskId}' was not found.`
        });
      }

      const taskId = existing.task_id;
      db.deleteSubtask(subtaskId);
      const parentTask = db.getTask(taskId);
      if (parentTask) {
        logSubtaskEvent(req, parentTask, 'SUBTASK_DELETED', subtaskId, { task_id: taskId, title: existing.title });
      }

      return res.status(200).json({
        success: true,
        message: 'Subtask deleted successfully',
        data: {
          deleted_subtask_id: subtaskId,
          task_progress_percentage: parentTask ? parentTask.progress_percentage : 0
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
}

module.exports = new SubtaskController();
