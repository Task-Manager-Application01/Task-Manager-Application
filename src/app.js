const http = require('http');
const url = require('url');
const authController = require('./controllers/authController');
const workspaceController = require('./controllers/workspaceController');
const taskController = require('./controllers/taskController');
const subtaskController = require('./controllers/subtaskController');
const notifController = require('./controllers/notifController');
const fileUploadService = require('./services/fileUploadService');
const taskDragDrop = require('./services/taskDragDrop');
const searchService = require('./services/searchService');
const analyticsService = require('./services/analyticsService');
const reportExporter = require('./services/reportExporter');
const auditLogger = require('./services/auditLogger');
const { verifyJWT } = require('./middleware/authMiddleware');
const { db } = require('./models/Database');

/**
 * Unified Enterprise REST API Server
 * Coordinates all modules for Team #4:
 * - Feature Set A (Chetana V Iyer): Auth, RBAC, Workspaces
 * - Feature Set B (Dhadhal Rudra): Task CRUD, Subtasks, Attachments
 * - Feature Set C (Gagan B Sasalatti): Kanban, Drag-Drop, Search, Tags
 * - Feature Set D (Harsh Pandya): Analytics, Reports, Notifications, Audit
 */
function createServer() {
  return http.createServer(async (req, res) => {
    res.status = function (statusCode) {
      this.statusCode = statusCode;
      return this;
    };
    res.json = function (data) {
      this.setHeader('Content-Type', 'application/json');
      this.end(JSON.stringify(data));
      return this;
    };

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();
    req.query = parsedUrl.query;
    req.params = {};

    // Extract Bearer token if present
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyJWT(token);
      if (decoded) req.user = decoded;
    }

    // Body parsing
    let bodyData = '';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await new Promise((resolve) => {
        req.on('data', chunk => { bodyData += chunk; });
        req.on('end', () => {
          if (bodyData) {
            try { req.body = JSON.parse(bodyData); } catch (e) { req.body = {}; }
          } else {
            req.body = {};
          }
          resolve();
        });
      });
    }

    try {
      // 1. Health Check
      if (method === 'GET' && pathname === '/health') {
        return res.status(200).json({
          status: 'UP',
          application: 'Task Manager Application',
          version: '1.0.0',
          team: 'Team #4 (Section C) - PES University',
          members: [
            { name: 'Chetana V Iyer', srn: 'PES1UG24CS130', role: 'Auth & Workspaces' },
            { name: 'Dhadhal Rudra', srn: 'PES1UG24CS146', role: 'Task Lifecycle & Content' },
            { name: 'Gagan B Sasalatti', srn: 'PES1UG24CS164', role: 'Kanban & Search' },
            { name: 'Harsh Pandya', srn: 'PES1UG24CS182', role: 'Analytics & Notifications' }
          ]
        });
      }

      // 2. Authentication Routes (Feature 1)
      if (method === 'POST' && pathname === '/api/v1/auth/register') {
        return await authController.register(req, res);
      }
      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        return await authController.login(req, res);
      }
      if (method === 'POST' && pathname === '/api/v1/auth/password-reset/request') {
        return await authController.requestPasswordReset(req, res);
      }
      if (method === 'POST' && pathname === '/api/v1/auth/password-reset/confirm') {
        return await authController.resetPassword(req, res);
      }

      // 3. Workspace & RBAC Routes (Feature 2)
      if (method === 'GET' && pathname === '/api/v1/workspaces') {
        return await workspaceController.listWorkspaces(req, res);
      }
      if (method === 'POST' && pathname === '/api/v1/workspaces') {
        return await workspaceController.createWorkspace(req, res);
      }
      const wsInviteMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/invite$/);
      if (method === 'POST' && wsInviteMatch) {
        req.params.workspaceId = wsInviteMatch[1];
        return await workspaceController.inviteMember(req, res);
      }
      const wsMembersMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members$/);
      if (method === 'GET' && wsMembersMatch) {
        req.params.workspaceId = wsMembersMatch[1];
        return await workspaceController.listMembers(req, res);
      }
      const wsSettingsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/settings$/);
      if (method === 'PUT' && wsSettingsMatch) {
        req.params.workspaceId = wsSettingsMatch[1];
        return await workspaceController.updateWorkspaceSettings(req, res);
      }
      const wsSingleMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)$/);
      if (wsSingleMatch) {
        req.params.workspaceId = wsSingleMatch[1];
        if (method === 'DELETE') {
          return await workspaceController.deleteWorkspace(req, res);
        }
      }

      // 4. Kanban & Workflow Routes (Feature 5)
      const wsKanbanMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/kanban$/);
      if (method === 'GET' && wsKanbanMatch) {
        const board = taskDragDrop.getKanbanBoard(wsKanbanMatch[1]);
        return res.status(200).json({ success: true, data: board });
      }
      const taskMoveMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/move$/);
      if (method === 'POST' && taskMoveMatch) {
        const taskId = taskMoveMatch[1];
        const { targetColumn, actorId } = req.body;
        const result = taskDragDrop.moveCard(taskId, targetColumn, actorId || (req.user ? req.user.userId : 'SYSTEM'));
        return res.status(200).json({ success: true, data: result });
      }
      const taskAssignMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/assign$/);
      if (method === 'POST' && taskAssignMatch) {
        const taskId = taskAssignMatch[1];
        const { userIds, actorId } = req.body;
        const result = taskDragDrop.assignCollaborators(taskId, userIds, actorId || (req.user ? req.user.userId : 'SYSTEM'));
        return res.status(200).json({ success: true, data: result });
      }

      // 5. Search & Filtering Routes (Feature 6)
      if (method === 'GET' && pathname === '/api/v1/search/tasks') {
        const results = searchService.queryTasks({
          workspaceId: req.query.workspace_id,
          queryText: req.query.q,
          priority: req.query.priority,
          status: req.query.status,
          assigneeId: req.query.assignee_id,
          startDate: req.query.start_date,
          endDate: req.query.end_date,
          tags: req.query.tags ? req.query.tags.split(',') : undefined,
          sortBy: req.query.sort_by,
          sortOrder: req.query.sort_order
        });
        return res.status(200).json({ success: true, ...results });
      }

      // 6. Analytics & Reporting Routes (Feature 7)
      const analyticsKpiMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/analytics\/kpi$/);
      if (method === 'GET' && analyticsKpiMatch) {
        const metrics = analyticsService.getKPIMetrics(analyticsKpiMatch[1]);
        return res.status(200).json({ success: true, data: metrics });
      }
      const analyticsDistMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/analytics\/distribution$/);
      if (method === 'GET' && analyticsDistMatch) {
        const dist = analyticsService.getVisualDistribution(analyticsDistMatch[1]);
        return res.status(200).json({ success: true, data: dist });
      }
      const reportCsvMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/reports\/csv$/);
      if (method === 'GET' && reportCsvMatch) {
        const csv = reportExporter.exportToCSV(reportCsvMatch[1]);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=report_${reportCsvMatch[1]}.csv`);
        return res.end(csv);
      }
      const reportSummaryMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/reports\/summary$/);
      if (method === 'GET' && reportSummaryMatch) {
        const summary = reportExporter.exportToDocumentSummary(reportSummaryMatch[1]);
        return res.status(200).json({ success: true, data: summary });
      }

      // 7. Notification & Audit Routes (Feature 8)
      const userNotifsMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/notifications$/);
      if (method === 'GET' && userNotifsMatch) {
        req.params.userId = userNotifsMatch[1];
        return await notifController.getUserNotifications(req, res);
      }
      const notifReadMatch = pathname.match(/^\/api\/v1\/notifications\/([^/]+)\/read$/);
      if (method === 'POST' && notifReadMatch) {
        req.params.notifId = notifReadMatch[1];
        return await notifController.markRead(req, res);
      }
      if (method === 'POST' && pathname === '/api/v1/notifications/trigger-deadline-alerts') {
        return await notifController.triggerDeadlineCheck(req, res);
      }
      const wsAuditMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/audit-logs$/);
      if (method === 'GET' && wsAuditMatch) {
        const timeline = auditLogger.getTimeline(wsAuditMatch[1]);
        return res.status(200).json({ success: true, count: timeline.length, data: timeline });
      }

      // 8. Task CRUD Routes (Feature 3)
      if (method === 'POST' && pathname === '/api/v1/tasks') {
        return await taskController.createTask(req, res);
      }
      if (method === 'GET' && pathname === '/api/v1/tasks') {
        return await taskController.listTasks(req, res);
      }
      const taskArchiveMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/archive$/);
      if (method === 'POST' && taskArchiveMatch) {
        req.params.taskId = taskArchiveMatch[1];
        return await taskController.archiveTask(req, res);
      }

      // Subtasks (Feature 4)
      const reorderMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/subtasks\/reorder$/);
      if (method === 'POST' && reorderMatch) {
        req.params.taskId = reorderMatch[1];
        return await subtaskController.reorderSubtasks(req, res);
      }
      const taskSubtasksMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/subtasks$/);
      if (taskSubtasksMatch) {
        req.params.taskId = taskSubtasksMatch[1];
        if (method === 'POST') return await subtaskController.addSubtask(req, res);
        if (method === 'GET') return await subtaskController.listSubtasks(req, res);
      }
      const singleSubtaskMatch = pathname.match(/^\/api\/v1\/subtasks\/([^/]+)$/);
      if (singleSubtaskMatch) {
        req.params.subtaskId = singleSubtaskMatch[1];
        if (method === 'PUT') return await subtaskController.updateSubtask(req, res);
        if (method === 'DELETE') return await subtaskController.deleteSubtask(req, res);
      }

      // Attachments (Feature 4)
      const taskAttachmentsMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/attachments$/);
      if (taskAttachmentsMatch) {
        req.params.taskId = taskAttachmentsMatch[1];
        if (method === 'POST') {
          const { file_name, file_size, mime_type, uploaded_by } = req.body;
          const result = await fileUploadService.processAttachment({
            taskId: req.params.taskId,
            fileName: file_name,
            fileSize: file_size,
            mimeType: mime_type,
            uploadedBy: uploaded_by
          });
          return res.status(201).json({ success: true, message: 'Attachment uploaded.', data: result });
        }
        if (method === 'GET') {
          const attachments = db.getAttachmentsByTaskId(req.params.taskId);
          return res.status(200).json({ success: true, count: attachments.length, data: attachments });
        }
      }
      const downloadMatch = pathname.match(/^\/api\/v1\/attachments\/download\/([^/]+)$/);
      if (method === 'GET' && downloadMatch) {
        const att = fileUploadService.verifyDownloadToken(downloadMatch[1]);
        if (!att) return res.status(404).json({ success: false, error: 'Not Found', message: 'Invalid or expired link.' });
        return res.status(200).json({ success: true, message: 'Download authorized.', data: att });
      }

      // Single Task operations
      const singleTaskMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
      if (singleTaskMatch) {
        req.params.taskId = singleTaskMatch[1];
        if (method === 'GET') return await taskController.getTaskById(req, res);
        if (method === 'PUT') return await taskController.updateTask(req, res);
        if (method === 'DELETE') return await taskController.deleteTaskPermanently(req, res);
      }

      return res.status(404).json({ success: false, error: 'Not Found', message: `Route ${method} ${pathname} not found.` });
    } catch (routeErr) {
      const statusCode = routeErr.statusCode || 500;
      return res.status(statusCode).json({ success: false, error: 'Request Failed', message: routeErr.message });
    }
  });
}

module.exports = { createServer };
