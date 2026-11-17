# Feature Set D — Viva Questions and Answers

## What did you implement?

I implemented analytics, progress reports, notifications, deadline alerts, audit
logging, and authorization hardening for Feature Set D.

## What KPI metrics are provided?

The system provides total tasks, completed tasks, overdue tasks, completion rate,
and team velocity. It also provides task-status and member-workload distributions.

## How is team velocity calculated?

Completed tasks in the configured sprint window are divided by the number of
sprint days and normalized to a seven-day rate.

## How are overdue tasks identified?

A task is overdue when its due date has passed and its status is not `Done`.
The due date is treated as ending at 23:59:59 to avoid timezone errors.

## Which report formats are supported?

The application supports CSV, structured summaries, and PDF progress reports.
CSV fields are quoted and escaped, and records use RFC 4180 CRLF line endings.

## How do deadline notifications work?

Deadline checks run at startup and on a server timer. An Admin can also trigger a
workspace-specific scan. Duplicate alerts within the configured suppression
window are avoided.

## Does the application send real email?

No. The default transport logs email messages. The service exposes a replaceable
transport so a real SMTP provider can be added without changing deadline logic.

## What is recorded in the audit log?

Workspace mutations, task changes, subtask actions, attachment actions, membership
changes, and other important activity are recorded with actor, action, target, and
details.

## How was access control improved?

Protected API routes require authentication, workspace membership is checked, Admin
operations are restricted, and actor identity is taken from the authenticated token
instead of request-body fields.

## What are the main limitations?

The system uses JSON persistence, metadata-only attachments, a plain HTML frontend,
a Latin-only built-in PDF font, and a logging email transport. Comment mentions are
not implemented because the application has no comments feature.

## How do you run and test the project?

```bash
npm start
npm test
npm run demo
```

The server runs on `http://localhost:3000`, with `/health`, `/kanban`, and
`/analytics` available for demonstration.
