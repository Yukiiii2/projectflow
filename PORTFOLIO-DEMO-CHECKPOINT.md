# ProjectFlow — Secure Portfolio Demo Checkpoint

Date: 2026-10-28
Status: implementation and isolated local verification complete; review required before commit, push, Neon migration, Render configuration, or deployment

## Outcome

ProjectFlow now has an opt-in, private, writable portfolio demo designed for Render Free and Neon Free. A visitor selects **Try Demo** on the sign-in page and receives a new server-created identity, workspace, and PostgreSQL-backed dataset. The visitor uses the same workspace, project, task, Kanban, comment, activity, and membership-read APIs as an ordinary account; no frontend-only mock state or authentication bypass was added.

Normal registration, email verification, password recovery, login, PostgreSQL sessions, workspace authorization, Resend delivery, and the existing production UI remain in place. Demo mode defaults to disabled. No production service, Neon database, provider credential, or existing user record was changed during this work.

## Architecture and seeded experience

Migration `006_portfolio_demo.sql` adds `demo_instances` plus nullable ownership markers on `users` and `workspaces`. Each demo instance is independent and contains:

- one `Demo Visitor` session identity with a non-authenticating password marker and a unique `.invalid` email;
- two synthetic teammates with owner/admin/member membership coverage;
- one private `Northstar Product Studio` workspace;
- three realistic projects and twelve tasks, evenly distributed across To do, In progress, and Done;
- assignments, priorities, due dates, task comments, and activity history.

The visitor can create and edit projects/tasks, move Kanban cards, reassign work among the synthetic members, and add/edit/delete comments through the real application APIs. The generated identities are excluded from password login and recovery queries and cannot receive verification or invitation email.

## Lifetime, cleanup, and free-tier bounds

- Absolute lifetime: 30 minutes from server creation; activity does not extend it.
- Immediate cleanup: logout destroys the session and deletes that instance's workspace/users through scoped cascading deletes.
- Opportunistic cleanup: expired instances are removed during demo creation and when an expired demo session reaches an authenticated API.
- No cron process, background worker, persistent disk, or paid service is required.
- Creation rate: 5 attempts per source IP per hour per running Express process.
- Active cap: 25 unexpired instances, serialized with a transaction-level PostgreSQL advisory lock.
- Per-instance limits: 5 projects (including archived), 40 tasks, 50 comments, and 200 activity events.
- Quota checks lock the instance row in the same database transaction as creation. Activity stops recording at its cap without breaking the visitor's already-authorized edit.

On Render Free, the in-process IP limiter resets on process restart and is not shared across multiple instances. The one-instance Free architecture and the database active-instance/quota controls remain the authoritative resource bounds. If the service is later scaled horizontally, replace or supplement the IP limiter with a shared rate-limit store before enabling demo mode.

## Security boundaries

Demo mode is enabled only by the strict boolean `DEMO_MODE_ENABLED=true`; the template and Render Blueprint default to `false`. Demo sessions still pass the normal server-side session-version and workspace-membership checks. Cross-workspace requests retain nondisclosing 404 responses.

Demo users cannot:

- access real users, real workspaces, or another visitor's demo workspace;
- create another workspace;
- list/create/revoke/accept invitations or trigger external email;
- change or remove workspace members;
- use email verification, password login, or password recovery;
- access profile/account controls in the UI; or
- receive development email capture through a production endpoint (no such endpoint exists).

The frontend hides privileged controls, but the API independently enforces every restriction. Generated email addresses, demo IDs, and seed data are not credentials. No passwords, tokens, connection strings, invitation tokens, verification tokens, or email-capture messages are returned or logged by the demo path.

## User experience and accessibility

- The public sign-in screen has a prominent keyboard-accessible **Try Demo** action and explains the 30-minute data lifetime before entry.
- A persistent live-region banner labels the private demo and explains isolation/cleanup.
- The profile identifies the session as a temporary demo.
- Workspace creation, invitation delivery, role changes, member removal, and account settings are absent in demo mode.
- Project/task/Kanban/comment interactions remain available.
- Desktop and 390×844 mobile browser layouts were verified without horizontal overflow.
- The demo dashboard passed an axe scan with no critical or serious violations. Existing navigation/profile accessible names were corrected without changing visual design.

## Verification evidence

All verification used local code and a loopback PostgreSQL connection. Browser QA created a uniquely named disposable schema, applied all six migrations there, and dropped the schema in `finally`. It did not connect to Neon or change the live Render service.

| Check | Result |
| --- | --- |
| Frontend Vitest | 8 files, 38 tests passed |
| Backend Vitest | 14 files, 90 tests passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Full production build | Passed; Vite SPA and compiled Express server present |
| Production bundle scan | Passed; no localhost API URL, development control, or secret marker |
| Render artifact verification | Passed |
| npm dependency audits | Root and backend: 0 vulnerabilities |
| Migration application/replay | Six applied in disposable schema, then six current on replay |
| Real-browser demo QA | Passed on desktop and mobile against isolated PostgreSQL |
| Browser isolation | Two identities, instances, and workspaces; cross-workspace request returned 404 |
| Persistence | Kanban move, task edit, and comment persisted in PostgreSQL |
| Restrictions | Workspace/invitation/member controls absent; server denials covered by API tests |
| Expiry/logout | Expired instance and signed-out instance deleted; final demo instance count zero |
| Accessibility | No critical or serious axe findings on demo dashboard |

The reusable command is `npm --prefix backend run verify:demo:browser`. It refuses a non-loopback PostgreSQL URL, requires a compiled frontend, uses an isolated schema, and verifies schema removal after the run.

## Controlled production enablement (not performed)

Do not push this code while Render auto-deploy is active until the additive database migration has been applied. The safe order is:

1. Keep Render `DEMO_MODE_ENABLED=false`.
2. Review the exact target Neon branch/database and create a recovery branch or restore point.
3. From the protected operator environment only, run all pending migrations with the direct `MIGRATION_DATABASE_URL`; never use the pooled runtime URL for the session advisory lock.
4. Replay the migration command and confirm six migrations are current, including `006_portfolio_demo.sql`.
5. Verify the pooled `projectflow_runtime` role inherited/received `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `demo_instances`, users, workspaces, and existing application tables, while retaining no schema creation, role, database, ownership, or migration-ledger privilege.
6. Commit/push only after review, allow CI and Render to deploy with demo mode still disabled, then verify `/api/health`, normal login/registration boundaries, and existing data.
7. Set `DEMO_MODE_ENABLED=true` in Render and verify two independent sessions, cross-workspace denial, quotas, 30-minute expiry, cleanup, and structured logs without personal/secret data.
8. Set the switch back to `false` immediately if instance count, 429/503 volume, database usage, or cleanup behavior is abnormal.

No migration rollback is required to disable the feature: set the switch to `false`. Migration 006 is additive and should remain in place. Existing demo rows, if any, expire and are removed opportunistically; an operator cleanup should be separately reviewed if immediate removal is ever required.

## Remaining hosted-only risks

- Render's real proxy/IP attribution, cold starts, restarts, log aggregation, and one-instance limiter behavior require hosted observation.
- Neon Free storage/connection impact under public traffic requires provider monitoring and alert thresholds.
- Runtime grants for the new table must be verified on the real Neon target after migration and before enabling the switch.
- Browser expiry was forced safely by changing only the disposable schema's expiry timestamp; a hosted 30-minute wall-clock wait remains optional confirmation.
- The public demo does not solve Resend's unverified-domain restriction. Normal registration still requires real email verification and production email remains Resend-only.
- No production migration, environment change, commit, push, deploy, paid service, DNS change, or provider operation was performed.
