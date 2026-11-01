const { db } = require('../models/Database');

/**
 * Multi-Criteria Search, Filtering & Tagging Engine
 * Owner: Gagan B Sasalatti | PES1UG24CS164
 * Feature 6 — Multi-Criteria Search, Filtering & Tagging Engine
 * REQ-6.1, REQ-6.2, REQ-6.3 | ARC-QUERY | DSN-06
 */

const PRIORITY_ORDER = {
  High: 3,
  Medium: 2,
  Low: 1
};

class SearchService {
  /**
   * REQ-6.1 & REQ-6.2 & REQ-6.3:
   * Real-time full-text search, composite tag querying, multi-field filtering, and sorting.
   */
  queryTasks({
    workspaceId,
    queryText,
    priority,
    status,
    assigneeId,
    startDate,
    endDate,
    tags,
    sortBy = 'created_at', // 'due_date', 'priority', 'created_at', 'title'
    sortOrder = 'desc', // 'asc', 'desc'
    includeArchived = false
  }) {
    const startTime = Date.now();

    // 1. Initial filtered set
    let results = db.findTasks(task => {
      // Workspace boundary
      if (workspaceId && task.workspace_id !== workspaceId) return false;

      // REQ-6.1: Full-Text Search across title, description, and tag labels
      if (queryText && queryText.trim()) {
        const needle = queryText.toLowerCase().trim();
        const titleMatch = task.title.toLowerCase().includes(needle);
        const descMatch = (task.description || '').toLowerCase().includes(needle);
        const tagMatch = (task.tags || []).some(t => t.toLowerCase().includes(needle));

        if (!titleMatch && !descMatch && !tagMatch) {
          return false;
        }
      }

      // REQ-6.2: Multi-Attribute Filtering
      if (priority && task.priority !== priority) return false;
      if (status && task.status !== status) return false;
      if (assigneeId) {
        const assignees = task.assignees || [];
        if (!assignees.includes(assigneeId)) return false;
      }

      // Date range filtering: tasks with no due date never match a range
      if (startDate || endDate) {
        if (!task.due_date) return false;
        const due = new Date(task.due_date);
        if (startDate && due < new Date(startDate)) return false;
        if (endDate && due > new Date(endDate)) return false;
      }

      // Composite tag filtering
      if (Array.isArray(tags) && tags.length > 0) {
        const taskTags = (task.tags || []).map(t => t.toLowerCase());
        const hasAllTags = tags.every(t => taskTags.includes(t.toLowerCase()));
        if (!hasAllTags) return false;
      }

      return true;
    }, includeArchived);

    // REQ-6.3: Sorting by due date or priority level
    results.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'priority') {
        const valA = PRIORITY_ORDER[a.priority] || 0;
        const valB = PRIORITY_ORDER[b.priority] || 0;
        comparison = valA - valB;
      } else if (sortBy === 'due_date') {
        const timeA = a.due_date ? new Date(a.due_date).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        const timeB = b.due_date ? new Date(b.due_date).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        comparison = timeA - timeB;
      } else if (sortBy === 'title') {
        comparison = a.title.localeCompare(b.title);
      } else {
        // Default created_at
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const executionTimeMs = Date.now() - startTime;

    return {
      total: results.length,
      execution_time_ms: executionTimeMs, // Verifies < 100ms requirement per REQ-6.1 stimulus
      data: results
    };
  }

  /**
   * REQ-6.3: Create and manage colored tags
   */
  createTag({ workspaceId, name, color = '#3b82f6' }) {
    const tagId = `tag_${Date.now()}`;
    const tag = {
      tag_id: tagId,
      workspace_id: workspaceId,
      name: name.trim(),
      color
    };
    db.tags.set(tagId, tag);
    return tag;
  }

  listTags(workspaceId) {
    const results = [];
    for (const tag of db.tags.values()) {
      if (!workspaceId || tag.workspace_id === workspaceId) {
        results.push({ ...tag });
      }
    }
    return results;
  }
}

module.exports = new SearchService();
