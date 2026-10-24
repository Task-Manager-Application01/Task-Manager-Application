# Task Manager Application — Team #4 (Section C)

PES University · UE24CS341A Software Engineering · Sprint-1

![CI](../../actions/workflows/ci.yml/badge.svg)

REST API for a multi-tenant task manager: auth & RBAC, workspaces, task CRUD, subtasks,
attachments, Kanban moves, search, analytics/reports, notifications and audit log.

## Run it
```bash
npm start          # http://localhost:3000  (health: /health)
npm test           # 37 unit + system tests (Node >= 18, no dependencies to install)
npm run demo       # end-to-end walkthrough; run while the server is up
```
Set `JWT_SECRET` in the environment for anything beyond a demo.

## Team & feature ownership
| Member | SRN | Feature set |
|---|---|---|
| Chetana V Iyer | PES1UG24CS130 | A — Auth, RBAC, Workspaces |
| Dhadhal Rudra | PES1UG24CS146 | B — Task CRUD, Subtasks, Attachments |
| Gagan B Sasalatti | PES1UG24CS164 | C — Kanban, Assignment, Search |
| Harsh Pandya | PES1UG24CS182 | D — Analytics, Reports, Notifications, Audit |

## Documents
`SRS/` and `docs/` hold the SRS, SAD and STP. Differences between those and the code are tracked in
[`docs/SPRINT1_DEVIATIONS.md`](docs/SPRINT1_DEVIATIONS.md). Demo video: [`demo-video/`](demo-video/).

## Workflow
Branch → PR using the template → CI green → review by a repo owner (CODEOWNERS) → merge. No direct pushes to `main`.
