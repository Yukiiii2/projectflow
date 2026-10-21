# ProjectFlow Stage E — Team Collaboration Checkpoint

**Status:** Complete and verified locally
**Date:** 2026-10-20
**Frontend:** http://localhost:5173
**API:** http://localhost:4000

## Completed scope

Stage E adds real PostgreSQL-backed collaboration while preserving the Stage A–D authentication, workspace, project, task, dashboard, and Kanban behavior.

- The Team screen loads the selected workspace roster and exposes controls according to the signed-in member's role.
- Owners can invite admins or members, change non-owner roles, revoke invitations, and remove admins or members.
- Admins can invite members, revoke member invitations, and remove members. Members can view the roster and collaborate on tasks.
- Removing a member clears that user's task assignments inside the workspace.
- Invitations support pending, accepted, expired, and revoked states. Acceptance requires an authenticated account with the invited normalized email.
- Raw invitation tokens are generated cryptographically, delivered only through the selected delivery channel, and stored in PostgreSQL only as SHA-256 hashes. List responses omit tokens.
- Preview delivery is explicit about not sending mail. Configurable SMTP delivery is available and reports success only when the transport accepts the recipient. Production rejects preview mode.
- Existing task panels include Details, Comments, and Activity tabs. Members can post comments; authors can edit or delete their own comments; owners and admins can delete any workspace comment for moderation.
- Comment responses include author identity, timestamps, edited state, and server-derived permission flags.
- Task activity records task creation and changes plus comment creation, edits, and deletion.
- Task assignees remain restricted to members of the task's workspace.

## Authorization and data isolation

All collaboration routes enforce the authenticated session and resolve resources through workspace membership. Cross-workspace member, comment, task activity, invitation-management, and assignment access is rejected. Hidden resources use a 404 response to avoid disclosing their existence.

Invitation acceptance atomically claims a pending invitation and creates or updates membership in one transaction. Accepted, revoked, expired, duplicate-pending, wrong-email, and already-member cases are validated by the API. Comment bodies are trimmed and constrained to 1–5,000 characters; invitation email and role payloads use strict validation.

## Database and migrations

`backend/sql/002_collaboration.sql` was applied successfully to the configured local PostgreSQL database. It adds:

- `workspace_invitations` with lifecycle timestamps and a unique pending-invitation constraint
- `activity_events` with workspace, project, task, actor, action, metadata, and timestamp fields
- `comments.edited_at`
- `workspace_members.joined_at`
- workspace, email, and activity lookup indexes

The migration is additive and did not reset or delete existing user data. The migration runner now executes all numbered SQL files in sorted order.

## Verified workflows

The `npm run collaboration:qa` browser workflow used unique temporary accounts and the real local PostgreSQL database. It verified:

- invitation creation through the Team UI and explicit preview delivery
- SHA-256 token storage rather than raw-token storage
- registration from an invitation URL, return-path restoration, acceptance, and persisted membership
- owner role changes and admin control boundaries
- rendered and persisted pending, accepted, expired, and revoked invitation states
- task assignment to an accepted workspace member
- comment creation, editing, owner moderation, timestamps, and persistence
- task activity rendering after task and comment changes
- cross-workspace member, comment, and activity requests returning 404
- authenticated session continuity throughout the collaboration workflow
- cleanup of all generated records; the final temporary-account count was zero

## Automated verification

| Check | Result |
| --- | --- |
| Frontend tests | 7 files, 29 tests passed |
| Backend tests | 4 files, 11 tests passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed; 1,946 modules transformed |
| Backend production build | Passed |
| Stage E PostgreSQL/browser QA | Passed |
| Axe checks in captured views | No violations |
| Horizontal overflow at 1440, 390, and 320 px | None detected |
| Static UI detector | Inter-only advisory; retained as an approved design-system requirement |

## Visual and responsive verification

Browser QA inspected the Team screen at 1440 × 1000, 390 × 844, and 320 × 720, plus the task Comments and Activity views at 390 × 844. Tables adapt to stacked cards, controls retain usable touch sizes, task-panel tabs remain visible, and captured pages have no unintended horizontal scrolling or out-of-bounds elements.

Generated QA reports and temporary responsive captures remain local. The public repository includes the [curated Team screen](./docs/images/team-collaboration.png).

## Main files changed

### Backend

- `backend/sql/002_collaboration.sql`
- `backend/src/collaboration.ts`
- `backend/src/collaboration.test.ts`
- `backend/src/invitation-delivery.ts`
- `backend/src/invitation-delivery.test.ts`
- `backend/src/app.ts`, `server.ts`, and `migrate.ts`
- `backend/src/app.test.ts`
- `backend/.env.example`, `backend/package.json`, and `backend/package-lock.json`

### Frontend and QA

- `src/collaboration/api.ts`
- `src/collaboration/TeamPage.tsx`
- `src/collaboration/InvitationAcceptPage.tsx`
- `src/collaboration/TaskCollaboration.tsx`
- `src/collaboration/CollaborationFlow.test.tsx`
- `src/projects/TaskPanel.tsx` and `src/projects/api.ts`
- `src/App.tsx`, `src/components/AppShell.tsx`, `src/auth/RouteGuards.tsx`, and `src/styles.css`
- `scripts/collaboration-qa.mjs` and `package.json`
- Stage E design/implementation notes under `docs/superpowers`

## Remaining limitations

- Local verification used the safe preview delivery mechanism. SMTP support is implemented but no external provider credentials were configured, so no real email is claimed as sent.
- Activity is task-focused and paginated only by a fixed recent-event limit; there is no workspace-wide audit feed yet.
- Collaboration updates require refresh or normal API reloads; WebSocket or server-sent real-time updates are outside Stage E.
- Workspace ownership transfer and self-removal are intentionally deferred.
- The prototype remains local and has not undergone production deployment, production mail-provider, rate-limit, or external security testing.

Stage E is complete. Further feature work should wait for review.
