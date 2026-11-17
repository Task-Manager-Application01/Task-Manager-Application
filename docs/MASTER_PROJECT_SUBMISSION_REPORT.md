# Task Manager Application — Master Project Submission Report

## 1. Project overview

The Task Manager Application is a dependency-free Node.js REST API for multi-tenant
task management. It supports authentication, role-based workspace access, task
management, subtasks, attachments, Kanban operations, search, analytics, reports,
notifications, and audit history.

The current implementation uses Node's built-in `http` and `crypto` modules and a
persistent JSON database with atomic snapshots and daily backups.

## 2. Feature ownership

| Feature set | Owner | Delivered functionality |
|---|---|---|
| A | Chetana V Iyer | Authentication, password reset, workspaces, invitations, RBAC |
| B | Dhadhal Rudra | Tasks, subtasks, attachments, persistence |
| C | Gagan B Sasalatti | Kanban, assignment, search, tags, real-time events |
| D | Harsh Pandya | Analytics, reports, notifications, deadline alerts, audit logs |

## 3. Feature Set D contribution

Feature Set D was delivered through the following merged pull requests:

- [#26](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/26):
  API authorization, workspace membership enforcement, token identity, and audit
  hardening.
- [#36](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/36):
  scheduled deadline checks and Admin-only manual triggering.
- [#37](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/37):
  subtask and attachment audit coverage.
- [#38](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/38):
  RFC 4180 CSV line endings and escaping coverage.
- [#39](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/39):
  status-change notifications from all update paths.
- [#40](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/40):
  configurable sprint-window KPI velocity.
- [#41](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/41):
  dependency-free PDF progress reports.
- [#42](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/42):
  replaceable email sender with a development logging transport.
- [#43](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/43):
  analytics charts page.
- [#44](https://github.com/Task-Manager-Application01/Task-Manager-Application/pull/44):
  Feature Set D deviations documentation.

## 4. Analytics and reporting

The analytics service calculates total tasks, completed tasks, overdue tasks,
completion rate, and team velocity. It also returns status distribution and
per-member workload allocation.

Reports are available as:

- RFC 4180-compatible CSV
- Structured document summaries
- PDF progress reports containing task, assignee, and subtask information

Relevant implementation:
[analyticsService.js](/Users/harshpandya/Documents/Study/PES/Task-Manager-Application/src/services/analyticsService.js),
[reportExporter.js](/Users/harshpandya/Documents/Study/PES/Task-Manager-Application/src/services/reportExporter.js).

## 5. Notifications and audit

The notification system supports user-specific notification retrieval, unread
counts, marking notifications as read, status-change alerts, and deadline alerts.
Deadline checks run at server startup and periodically thereafter. The default
email transport logs messages because the submitted STP excludes third-party SMTP.

The audit service records append-only workspace activity. Audit details are
deep-copied before persistence and timelines are returned newest-first.

Relevant implementation:
[notifController.js](/Users/harshpandya/Documents/Study/PES/Task-Manager-Application/src/controllers/notifController.js),
[auditLogger.js](/Users/harshpandya/Documents/Study/PES/Task-Manager-Application/src/services/auditLogger.js).

## 6. Security and authorization

Protected API routes require a valid token. Workspace membership and role are
checked before workspace-scoped operations. User identity for actor, creator, and
uploader fields is derived from the token rather than trusted request-body values.
Users can read or update only their own notifications, and Admin-only operations
are enforced.

## 7. Testing and CI

The repository includes unit, integration, system, security, persistence,
analytics, reporting, notification, and UI-route tests. The repository CI
workflow runs the automated test suite across the supported Node versions.

Local commands:

```bash
npm test
npm start
npm run demo
```

The latest reviewed Feature Set D pull request checks completed successfully.

## 8. Accepted deviations and remaining limitations

The remaining differences from the submitted SRS/SAD/STP are documented in
[SPRINT1_DEVIATIONS.md](/Users/harshpandya/Documents/Study/PES/Task-Manager-Application/docs/SPRINT1_DEVIATIONS.md).
The most important items to explain during the final demonstration are:

- JSON persistence is used instead of PostgreSQL and Redis.
- The frontend is plain HTML rather than a React SPA.
- Attachments validate and store metadata, not uploaded file bytes.
- The PDF writer uses a built-in Latin font.
- Email delivery is logged rather than sent through SMTP.
- Comment-mention notifications depend on a comments feature that does not exist.

## 9. Sprint 3 completion plan

Sprint 3 should be treated as the documentation, packaging, and release phase:

1. Run `npm test` and record the exact result.
2. Start the server and run `npm run demo`.
3. Package the repository into a runnable ZIP, excluding `.git`, local database
   backups, and editor/system files.
4. Upload the report and ZIP to the team’s approved Drive location.
5. Demonstrate the health endpoint, authentication, workspace authorization,
   analytics page, Kanban page, report export, notifications, and audit history.
6. Track the remaining product gaps as Sprint 3 follow-up issues rather than
   presenting them as completed requirements.
