# Sprint-1 Deviations from SRS / SAD / STP

Team #4 (Section C) — Sprint-1 (19–23 Oct 2026)
Status legend: **Open** = still differs from the submitted documents · **Accepted** = intentional, to be explained at final demo.

> Every item below was verified against the code in this repository (not assumed).
> Fill in the **Owner / Target sprint** column before the final demo.

| # | Area | Submitted document says | What the code actually does | Status | Owner / Target |
|---|------|------------------------|-----------------------------|--------|----------------|
| 1 | Backend framework | SAD 3.6: Express.js REST gateway | Node core `http` module with a hand-written regex router in `src/app.js` | Accepted (zero-dependency; revisit if Express middleware is needed) | |
| 2 | Database | SRS 2.4 / SAD 3.6 / STP: PostgreSQL 15+ (+ Redis 7) with transactional persistence | Persistent file-backed JSON store with atomic snapshot persistence and automated daily backups (`data/database.json` & `data/backups/`). Full transactional cascading deletes and archiving preserved | Resolved, with file-based persistence Accepted | Dhadhal Rudra / Sprint 2 |
| 3 | Frontend | SRS/SAD: React 18 SPA | Only one component (`src/components/KanbanBoard.jsx`); no React dependency, bundler, or page that renders it. The demo is API-only | Open | |
| 4 | Password hashing | SRS REQ-1.2 / SAD / STP: salted **bcrypt**, work factor ≥ 10 | PBKDF2-SHA512, 10,000 iterations (`authMiddleware.js`). STP case "iteration cost factor ≥ 10" cannot be verified as written | Open | |
| 5 | JWT | SRS: signed JWT | Hand-rolled HS256 with a **hard-coded fallback secret** if `JWT_SECRET` is unset | Open (must set `JWT_SECRET` in any real deployment) | |
| 6 | Authentication enforcement | SRS RBAC: only authorised members may create/modify tasks | All `/api/v1/` routes past the public auth routes require a token, except signed attachment downloads. Workspace membership and role are checked, and identity comes from the token (PR #26) | Resolved | Harsh Pandya / Sprint 1 |
| 7 | Attachments | SRS Feature 4: multi-format document uploads | Only metadata (name, size, MIME) is validated and recorded; **no file bytes are received or stored**. Limits (10 MB, allowed types) are enforced | Open | |
| 8 | Real-time updates | SRS 4.5: real-time event broadcast of Kanban changes to other viewers | Server-Sent Events: `GET /api/v1/workspaces/:id/events` streams `task.moved` events to authorized members of that workspace (`src/services/realtimeService.js`). No WebSocket | Resolved | Gagan B Sasalatti / Sprint 2 |
| 9 | Report export | SRS Feature 7: PDF/CSV export | CSV and PDF export are implemented (PR #38, PR #41). The PDF uses a built-in Latin font, so unsupported characters appear as `?` | Resolved, with the font limitation Accepted | Harsh Pandya / Sprint 2 |
| 10 | Notifications | SRS Feature 8: in-app deadline alerts | Deadline checks run on a server timer, hourly by default. The manual trigger is limited to workspace Admins (PR #36) | Resolved | Harsh Pandya / Sprint 2 |
| 11 | Node version | SAD/STP: Node 18 LTS | CI runs Node 18, 20 and 22; `npm test` was fixed so it works on all (see #12) | Resolved | |
| 12 | Test runner script | — | Original `node --test tests/` fails on Node 22 (treats the folder as a module). Changed to `node --test tests/*.test.js` | Resolved in this sprint | |
| 13 | Single-author history | Sprint rules: assigned member raises the PR; repo owners review/merge | All 27 existing commits are by one account and pushed straight to `main`; no PRs exist yet | Open — from Sprint-1 onward every change must go through a PR | |
| 14 | Deadline emails | SRS REQ-8.2: dispatch email notifications for approaching deadlines | Alerts go through a replaceable email sender that only logs messages (PR #42). No real email is sent, because the STP excludes third-party SMTP | Accepted | Harsh Pandya / Sprint 2 |
| 15 | Comment-mention notifications | SRS REQ-8.1: notify users on comment mention | Not implemented, because the application has no comments feature and none is specified in Feature Set D | Open | Harsh Pandya / depends on a comments feature |

## How to read this at the final demo
Items 2, 3, 6 and 7 are the most visible gaps against the SAD/STP; be ready to say either
"scheduled for Sprint-N" or "dropped because …" for each.
