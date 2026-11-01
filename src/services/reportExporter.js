const { db } = require('../models/Database');
const { buildPdf } = require('./pdfDocument');

/**
 * Report Exporter Service
 * Owner: Harsh Pandya | PES1UG24CS182
 * Feature 7 — Progress Analytics, Metrics & Exportable Reports
 * REQ-7.3 | ARC-RPT | DSN-07
 */
class ReportExporter {
  /**
   * Generates CSV report of all workspace tasks with complete execution metadata
   */
  exportToCSV(workspaceId) {
    const tasks = db.findTasks(t => !workspaceId || t.workspace_id === workspaceId, true);

    const rawHeaders = [
      'Task ID',
      'Workspace ID',
      'Title',
      'Priority',
      'Status',
      'Progress %',
      'Due Date',
      'Created By',
      'Assignees Count',
      'Is Archived',
      'Created At',
      'Updated At'
    ];

    const escapeCsvField = (field) => {
      if (field === null || field === undefined) return '""';
      const str = String(field).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = rawHeaders.map(escapeCsvField);

    const rows = tasks.map(t => [
      escapeCsvField(t.task_id),
      escapeCsvField(t.workspace_id),
      escapeCsvField(t.title),
      escapeCsvField(t.priority),
      escapeCsvField(t.status),
      escapeCsvField(t.progress_percentage),
      escapeCsvField(t.due_date),
      escapeCsvField(t.created_by),
      escapeCsvField((t.assignees || []).length),
      escapeCsvField(t.is_archived),
      escapeCsvField(t.created_at),
      escapeCsvField(t.updated_at)
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Generates structured report payload for PDF or programmatic consumption
   */
  exportToDocumentSummary(workspaceId) {
    const tasks = db.findTasks(t => !workspaceId || t.workspace_id === workspaceId);
    const workspace = workspaceId ? db.getWorkspace(workspaceId) : null;

    return {
      report_generated_at: new Date().toISOString(),
      workspace: workspace ? { id: workspace.workspace_id, title: workspace.title } : { title: 'All Workspaces' },
      task_count: tasks.length,
      tasks: tasks.map(t => ({
        task_id: t.task_id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        progress: `${t.progress_percentage}%`,
        due_date: t.due_date || 'None',
        assignees: (t.assignees || []).map(uid => {
          const u = db.getUser(uid);
          return u ? u.full_name : uid;
        }),
        subtasks: db.getSubtasksByTaskId(t.task_id).map(s => ({
          title: s.title,
          completed: s.is_completed
        }))
      }))
    };
  }

  /**
   * REQ-7.3: Generates the progress summary as a PDF document
   */
  exportToPDF(workspaceId) {
    const report = this.exportToDocumentSummary(workspaceId);
    const lines = [
      `Workspace: ${report.workspace.title}`,
      `Generated: ${report.report_generated_at}`,
      `Tasks: ${report.task_count}`,
      ''
    ];

    report.tasks.forEach(task => {
      lines.push(
        task.title,
        `  Priority: ${task.priority} | Status: ${task.status} | Progress: ${task.progress} | Due: ${task.due_date}`,
        `  Assignees: ${task.assignees.length ? task.assignees.join(', ') : 'None'}`
      );
      task.subtasks.forEach(subtask => {
        lines.push(`  [${subtask.completed ? 'x' : ' '}] ${subtask.title}`);
      });
      lines.push('');
    });

    return buildPdf('Task Progress Report', lines);
  }
}

module.exports = new ReportExporter();
