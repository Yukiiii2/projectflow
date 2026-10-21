# ProjectFlow Stage D — Kanban Board and Task Workflow Checkpoint

## Status

Stage D is complete and verified. The Kanban board uses the existing authenticated task API and PostgreSQL records; it does not maintain a separate task store. Stages A–C remain intact. Team invitations, comments UI, advanced analytics, and other later-stage features have not started.

## Completed functionality

### Board and task workflow

- `/board` groups the selected workspace's tasks into **To do**, **In progress**, and **Done**.
- Native pointer drag-and-drop moves tasks between columns and persists each status through `PATCH /api/tasks/:taskId`.
- Every card also has a labeled status selector, providing a keyboard and touch alternative to dragging.
- Successful moves show a reversible **Undo** action. Failed moves keep the task in its server-confirmed column and provide **Retry** and **Dismiss** actions.
- Task cards expose project, priority, assignee, due date, description, and current status.
- Card titles open the existing task edit panel; the board's create action opens the existing task creation panel.
- Updates flow through `ProjectsContext`, so the board, project views, task list, and dashboard share one current task state.

### States and responsive behavior

- Loading uses a three-column board skeleton.
- Load failures provide an accessible error message and retry action.
- Workspaces without projects link to project setup; projects without tasks receive a focused first-task empty state.
- Desktop uses three equal workflow columns.
- Tablet retains all three columns with compact cards and controls.
- Mobile and 320 px layouts use a three-tab column switcher, one visible column, full-width creation control, and the existing mobile navigation.
- Dark and light theme tokens, visible focus indicators, reduced-motion behavior, and minimum mobile control sizes are inherited from the established design system.

## Authorization and data integrity

- The selected workspace remains the frontend data scope.
- Workspace membership is enforced by the API before task lists or task updates are returned.
- Owners, admins, and members can move tasks in workspaces to which they belong, matching the existing task-edit policy.
- Non-members receive `404` for workspace task reads and task updates, preventing resource discovery across workspaces.
- The board waits for a successful API response before shared task state changes. A failed request therefore leaves the original status visible and recoverable.
- PostgreSQL persistence was checked after drag, selector movement, undo, retry, and full browser refresh.

## Verification evidence

| Check | Result |
| --- | --- |
| Frontend test files | 6 passed |
| Frontend tests | 27 passed |
| Focused Kanban tests | 4 passed |
| Backend test files | 2 passed |
| Backend tests | 6 passed |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Frontend production build | Passed |
| Backend production build | Passed |
| Native drag and PostgreSQL persistence | Passed |
| Refresh persistence | Passed |
| Keyboard-accessible status movement | Passed |
| Undo and failed-update retry | Passed |
| Existing create/edit panels from board | Passed |
| Member task movement | Passed |
| Cross-workspace reads and updates | `404` verified |
| Desktop visual check | 1440 px passed |
| Tablet visual check | 768 px passed |
| Mobile visual checks | 390 px and 320 px passed |
| Stage D axe violations | 0 |
| Horizontal overflow | 0 at tested widths |
| Temporary Stage D accounts remaining | 0 |

The backend regression suite now also reloads the workspace task collection after a member status update and asserts that the moved status is returned.

Reports and captures:

- `artifacts/kanban-qa-report.json`
- `artifacts/screenshots/stage-d-kanban-desktop.png`
- `artifacts/screenshots/stage-d-kanban-tablet.png`
- `artifacts/screenshots/stage-d-kanban-mobile.png`
- `artifacts/screenshots/stage-d-kanban-narrow.png`

## Development server state

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- No process is listening on port `5174`.

## Remaining limitations

- The board persists workflow status but does not add manual ordering within a column; cards follow the existing API task order.
- Updates are request/response based. Real-time multi-user synchronization is outside Stage D.
- Comments APIs exist, but comments UI and collaboration flows remain deferred.
- Team invitations, notifications, calendar, attachments, advanced analytics, customizable workflows, and integrations remain later work.
- The design detector flags Inter as an overused font. Inter is retained because it is required by the approved ProjectFlow design direction.

## Review gate

Review the Kanban workflow, recovery controls, task card density, and responsive column behavior. Do not begin the next stage until Stage D is approved.
