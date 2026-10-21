# ProjectFlow Stage B — Workspace Integration Checkpoint

## Status

Stage B is complete and ready for review. The React frontend now uses PostgreSQL-backed workspace records and memberships through the existing Express API. Project, task, completion, and activity content remains the approved local dashboard fixture until a later integration stage.

## Completed behavior

- Authenticated sessions load memberships from `GET /api/workspaces` with cookies included.
- The dashboard workspace selector is populated only from the signed-in user's API response.
- The last selected workspace is restored from user-scoped local storage only when that ID is still present in the latest membership response.
- Workspace switching resets local dashboard interaction state and swaps the selected workspace identity while retaining the approved mock project and task fixtures.
- New users receive a designed first-workspace state instead of an unrelated default workspace.
- Authenticated users can create additional workspaces at `/workspaces/new`; successful creation selects the returned owner workspace.
- Owner and member roles are visible in the application shell.
- Workspace loading, empty, retryable error, validation, submission, network failure, and expired-session states are handled.
- A workspace API 401 clears frontend auth state and returns the user to sign in with an expiration notice.
- Desktop, tablet, mobile, and narrow layouts preserve the approved Modern Professional visual direction.

## Data boundary

The workspace context accepts a selected ID only when that ID exists in the current authenticated membership list. Stored IDs from another user or a removed membership are discarded. Selection persistence is keyed by authenticated user ID.

The dashboard's project and task content remains local by design. A deterministic fixture is attached to each selected real workspace ID and is never loaded from another user's database records. No project, task, or comment API integration was added in Stage B.

The API continues to enforce authorization server-side:

- unauthenticated workspace requests return `401`;
- workspace lists use a membership join scoped to the session user;
- non-members receive `404` for workspace resources;
- members can read workspace projects but receive `403` when attempting owner/admin-only project creation.

## API contract refinement

`POST /api/workspaces` now returns the complete selector record:

```json
{
  "workspace": {
    "id": "uuid",
    "name": "Workspace name",
    "role": "owner",
    "created_at": "ISO-8601 timestamp"
  }
}
```

The transaction still creates the workspace and owner membership atomically.

## Verification evidence

The automated live-browser workflow used two unique `.invalid` accounts and temporary workspaces. It verified first-workspace onboarding, additional creation, database persistence, list isolation, switching, refresh restoration, owner/member role display, anonymous rejection, member permission limits, non-member resource hiding, responsive layouts, and WCAG-tagged axe checks. It removed all generated users, sessions, memberships, and workspaces afterward.

Reports and captures:

- `artifacts/workspace-qa-report.json`
- `artifacts/auth-qa-report.json`
- `artifacts/visual-qa-report.json`
- `artifacts/screenshots/workspace-empty-desktop.png`
- `artifacts/screenshots/workspace-dashboard-desktop.png`
- `artifacts/screenshots/workspace-create-desktop.png`
- `artifacts/screenshots/workspace-create-mobile.png`
- `artifacts/screenshots/workspace-create-narrow.png`

| Check | Result |
| --- | --- |
| Frontend unit and interaction tests | 19 passed |
| Backend API tests | 5 passed |
| Frontend and backend TypeScript checks | Passed |
| Frontend and backend production builds | Passed |
| Frontend and backend production dependency audits | 0 vulnerabilities |
| Real workspace browser workflow | Passed |
| Existing real authentication browser workflow | Passed |
| Dashboard responsive visual states | 12 passed |
| Workspace onboarding and creation captures | 5 passed |
| Workspace capture axe violations | 0 |
| Temporary Stage A/Stage B accounts remaining | 0 |

## Configuration

- Frontend API URL: `VITE_API_URL=http://localhost:4000`, or use the existing default.
- Backend browser origin: `FRONTEND_ORIGIN=http://localhost:5173` for the normal Vite development URL.
- PostgreSQL credentials and `SESSION_SECRET` remain only in `backend/.env`.
- Run the real workspace workflow with `npm.cmd run workspace:qa` while PostgreSQL, the backend, and the frontend are running.

## Remaining limitations

- Dashboard project, task, activity, and chart content is still illustrative local data. Stage B does not query project or task endpoints.
- Team invitation and membership-management endpoints do not exist in the current backend foundation, so Stage B displays membership roles but does not add invitation controls.
- Workspace rename, leave, transfer, archive, and deletion workflows remain outside this stage.
- Production rate limiting, audit trails, email flows, HTTPS/proxy validation, and broader security hardening remain required before public deployment.
- The design detector flags Inter as an overused font; Inter is retained because it is an explicit approved ProjectFlow design-system requirement.

## Review gate

Review workspace onboarding, creation, switching, role visibility, responsive behavior, and the continued use of mock dashboard product data. Project and task API integration must wait for approval of this stage.
