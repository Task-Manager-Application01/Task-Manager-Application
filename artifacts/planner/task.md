# Implementation Plan: Complete Task Manager Application (Team #4)

- [x] **Phase 1: Due Diligence & Architecture Specification**
  - [x] Audit requirements from SRS for all 4 team members (Chetana, Rudra, Gagan, Harsh)
  - [x] Consolidate RTM mapping, design refs (DSN-01 to DSN-08), architectural refs (ARC-AUTH to ARC-NOTIF), and code files
  - [x] Design integrated in-memory transactional database schema for Users, Workspaces, Memberships, Tasks, Subtasks, Attachments, Tags, Notifications, and Audit Logs

- [x] **Phase 2: Feature Set A Implementation (Chetana V Iyer — PES1UG24CS130)**
  - [x] Implement `src/controllers/authController.js` (Registration, bcrypt hashing, JWT issuance, password reset)
  - [x] Implement `src/middleware/authMiddleware.js` (JWT token verification, route protection)
  - [x] Implement `src/controllers/workspaceController.js` (Workspace CRUD, member invitations)
  - [x] Implement `src/services/rbacService.js` (Role checks: Admin, Member, Viewer; destructive mutation guards)

- [x] **Phase 3: Feature Set B Integration (Dhadhal Rudra — PES1UG24CS146)**
  - [x] Integrate existing `taskController.js`, `subtaskController.js`, and `fileUploadService.js` with RBAC and Audit Logger
  - [x] Ensure cascading soft/hard delete and progress % recalculation maintain atomic consistency

- [x] **Phase 4: Feature Set C Implementation (Gagan B Sasalatti — PES1UG24CS164)**
  - [x] Implement `src/services/taskDragDrop.js` & collaborator assignment (Kanban 4-column transitions, optimistic sync, Rule 1 check)
  - [x] Implement `src/services/searchService.js` (Full-text search, multi-criteria filtering by priority/status/assignee/dates, custom colored tags & sorting)
  - [x] Implement `src/components/KanbanBoard.jsx` (Interactive React Kanban board UI component with avatars, columns, and drag-and-drop handles)

- [x] **Phase 5: Feature Set D Implementation (Harsh Pandya — PES1UG24CS182)**
  - [x] Implement `src/services/analyticsService.js` (KPI metrics: total, completed, overdue, velocity; status & workload distributions)
  - [x] Implement `src/services/reportExporter.js` (Structured progress summaries in CSV and JSON/PDF-ready formats)
  - [x] Implement `src/controllers/notifController.js` (In-app notification center, unread tracking, automated 24h deadline checks)
  - [x] Implement `src/services/auditLogger.js` (Append-only immutable audit trail for all workspace mutations)

- [x] **Phase 6: Unified API Routing, Server & End-to-End Test Suite**
  - [x] Update `src/app.js` and `src/server.js` to route all endpoints across all 8 features
  - [x] Write and execute comprehensive unit & system tests covering all RTM IDs:
    - UT-AUTH-01, UT-AUTH-02, ST-AUTH-01, ST-AUTH-02
    - UT-WS-01, UT-WS-02, ST-WS-01, ST-WS-02
    - UT-TASK-01, UT-TASK-02, UT-FILE-01, ST-TASK-01, ST-TASK-02, ST-FILE-01
    - UT-KB-01, UT-KB-02, ST-KB-01, ST-KB-02
    - UT-SRCH-01, ST-SRCH-01
    - UT-RPT-01, UT-RPT-02, ST-RPT-01, ST-RPT-02
    - UT-NOTIF-01, UT-NOTIF-02, ST-NOTIF-01, ST-NOTIF-02
  - [x] Verify 100% test pass rate (152 of 152 passed)
  - [x] Add frontend task creation, editing, archiving, and deletion controls to the Kanban page
  - [x] Add Kanban page contract coverage for the frontend task CRUD controls

- [/] **Phase 7: Packaging, Master Submission Report & Drive Export (Sprint 3)**
  - [x] Generate comprehensive Master Project Submission Report documenting all 4 modules, architecture, APIs, and RTM
  - [x] Generate Feature Set D viva question-and-answer document
  - [x] Package entire project into complete runnable ZIP archive
  - [ ] Upload Master Report and ZIP archive to Google Drive
