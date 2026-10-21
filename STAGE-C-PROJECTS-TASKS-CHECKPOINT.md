# ProjectFlow Stage C — Projects and Tasks Integration Checkpoint

## Status

Stage C is complete and verified. Project and task workflows now use the authenticated, PostgreSQL-backed API. Stage A authentication and Stage B workspace behavior remain intact. Kanban collaboration, comments UI, and advanced analytics have not started.

## Completed functionality

### Projects

- `/projects` lists active projects for the selected workspace and supports search, loading, empty, error, and permission states.
- Owners and admins can create, edit, and archive projects.
- Members can read projects but do not receive project-management controls.
- `/projects/:projectId` presents project description, completion progress, task totals, next due date, and project tasks.
- Archived projects and their tasks disappear from active workspace responses and remain hidden after refresh.

### Tasks

- Workspace members can create and edit tasks within projects they can access.
- Task fields include title, description, status, priority, date-only due date, and optional workspace-member assignee.
- Project detail supports quick status updates and a complete edit side panel.
- `/tasks` lists tasks across the selected workspace with status filters and task editing.
- The API rejects assignees who are not members of the task's workspace.

### Dashboard and application shell

- Project and task mock records were replaced with selected-workspace API data.
- Active project count, completed/total tasks, due-this-week tasks, overdue tasks, project progress, and upcoming tasks are calculated from PostgreSQL-backed responses.
- Completing a task updates dashboard metrics immediately and remains correct after refresh.
- Recent activity uses an explicit empty state because Stage C does not add an activity event API.
- Sidebar and mobile navigation now link to Dashboard, Projects, and My tasks. Deferred destinations continue to explain their availability.
- Dark/light themes, authentication, logout, workspace creation, workspace switching, responsive navigation, and saved workspace selection remain functional.

## Authorization and isolation

The frontend treats the selected workspace as its data scope, but authorization remains server-side:

- unauthenticated requests return `401`;
- workspace project, task, and member lists require membership;
- non-members receive `404` for workspace, project, task, and comment resources;
- project creation, editing, and archiving require owner or admin role;
- workspace members may create and update tasks;
- assignees must belong to the same workspace;
- stale responses are discarded when the selected workspace changes.

Automated API tests and the real PostgreSQL browser workflow verified these boundaries with isolated temporary owner, member, and non-member data.

## Date-only correction

PostgreSQL `DATE` values are calendar dates rather than instants. The backend now configures OID `1082` to return the PostgreSQL wire value as `YYYY-MM-DD`. API response normalization also converts any date object supplied by a compatible test adapter into a local calendar string. This prevents UTC conversion from moving a due date by one day.

Regression evidence:

- the complete backend suite passed with `TZ=UTC`, `TZ=America/Los_Angeles`, and `TZ=Asia/Taipei`;
- API tests assert `due_date` and aggregated `next_due_date` remain `2026-10-23`;
- the real PostgreSQL workflow entered, stored, returned, and rendered `2026-10-27` as October 27;
- the exact stored value was checked with `due_date::text`.

## Verification evidence

| Check | Result |
| --- | --- |
| Frontend test files | 5 passed |
| Frontend tests | 23 passed |
| Backend test files | 2 passed |
| Backend tests | 6 passed |
| Date parser checks in three timezones | 3 passed |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Frontend production build | Passed |
| Backend production build | Passed |
| Real PostgreSQL project/task workflow | Passed |
| Owner/member permission checks | Passed |
| Cross-workspace non-member read | `404` verified |
| Desktop visual check | 1440 px passed |
| Mobile visual checks | 390 px and 320 px passed |
| Stage C axe violations | 0 |
| Horizontal overflow | 0 at tested widths |
| Temporary Stage C accounts remaining | 0 |

The live workflow verified project creation, rename, archive, task creation, assignment, priority, due date, status, refresh persistence, member task creation, owner/member controls, database-backed dashboard metrics, and cleanup.

Reports and captures:

- `artifacts/project-task-qa-report.json`
- `artifacts/screenshots/stage-c-projects-desktop.png`
- `artifacts/screenshots/stage-c-project-detail-desktop.png`
- `artifacts/screenshots/stage-c-project-detail-mobile.png`
- `artifacts/screenshots/stage-c-project-detail-narrow.png`

## Development server state

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- A duplicate Vite process on port `5174` was confirmed to use this same repository and was stopped. The explicitly configured port `5173` process remains active.

## Remaining limitations

- Recent activity is not persisted because there is no activity event model or endpoint yet.
- The completion chart is a current-workspace presentation derived from the current completion rate; historical analytics are not stored.
- Task deletion, project restoration, project deletion, bulk actions, and advanced filters are outside Stage C.
- Comments endpoints exist in the backend, but comments UI and collaboration flows are deferred.
- Kanban, invitations, notifications, calendar, attachments, advanced analytics, and external integrations remain later release work.
- Production rate limiting, audit history, email flows, deployment configuration, and broader security hardening remain required before public release.
- The design detector flags Inter as an overused font. Inter is retained because the approved ProjectFlow design specification explicitly requires it.

## Review gate

Review the database-backed dashboard, project and task workflows, role behavior, responsive layouts, and date handling. Do not begin Stage D or Kanban collaboration until this checkpoint is approved.
