# ProjectFlow Stage F — QA, Security Hardening, and UI/UX Checkpoint

**Status:** Complete and verified locally
**Date:** 2026-10-20
**Frontend:** http://localhost:5173
**API:** http://localhost:4000

## Scope and outcome

Stage F reviewed and tested the completed Stage A–E application without adding product features or changing the approved Modern Professional direction. The complete registration-to-collaboration journey passed against the configured local PostgreSQL database. Confirmed API-boundary, session-feedback, and keyboard-accessibility defects were fixed with regression coverage.

## Verified findings

### Complete application journey

- Registration created an Argon2id-backed account and a server-side session.
- First-workspace onboarding created an owner membership and loaded the empty dashboard.
- Project and task creation persisted names, descriptions, assignees, priorities, statuses, and date-only due dates.
- Dashboard project and task statistics matched PostgreSQL records.
- Kanban movement persisted and remained correct after browser refresh.
- Invitation creation stored only a SHA-256 token hash; account registration returned to the invitation; acceptance created the expected membership.
- Owner role changes, authorized assignment, comments, activity history, logout, sign-in, protected-route redirect, and session restoration passed.
- All generated users, workspaces, sessions, projects, tasks, comments, invitations, and activity records were cleaned up. The final temporary-account count was zero.

### Authentication and session security

- Passwords are constrained to 12–128 characters and stored as Argon2id hashes rather than plaintext.
- Login and registration regenerate and save the session before returning authenticated state, reducing session-fixation risk.
- Logout destroys the server session and clears the matching cookie.
- Development cookies are HttpOnly and SameSite=Lax. Production cookies additionally use Secure and the host-bound `__Host-projectflow.sid` name with `Path=/` and no Domain attribute.
- Production startup rejects HTTP frontend origins, preview invitation delivery, short session secrets, and the documented placeholder secret.
- Failed logins are limited to 10 per 15 minutes per IP, excluding successful logins. Registrations are limited to 20 per hour per IP.
- A 401 from any protected frontend API area now expires local application state immediately and redirects to sign-in with clear feedback.

### CSRF, validation, API boundaries, and errors

- Every state-changing route uses POST, PATCH, or DELETE; no reviewed GET route mutates data.
- State-changing requests require an exact configured Origin. Missing and hostile origins return 403. SameSite=Lax remains an additional browser defense.
- API JSON bodies are limited to 64 KB. Oversized bodies now return a controlled 413 JSON response instead of a generic 500.
- Malformed JSON, invalid UUIDs, invalid enum values, impossible calendar dates, unknown fields, empty updates, oversized text fields, and duplicate records receive bounded client errors.
- Unknown routes return a consistent JSON 404, while unexpected errors return a generic 500 without response stack traces.
- Helmet supplied `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Cross-Origin-Resource-Policy: same-origin` in the live API workflow.
- Both frontend and backend dependency audits reported zero known vulnerabilities.

### Authorization and data isolation

- Direct outsider reads and writes were exercised against workspace projects, workspace tasks, member lists, invitation lists, project details, project tasks, task updates, comments, activity, and comment updates.
- Every inaccessible resource returned 404 and disclosed no cross-workspace data.
- Project management remains owner/admin-only. Task workflow remains available to workspace members. Assignment is restricted to members of the same workspace.
- Invitation acceptance remains email-matched, single-use, atomic, expiring, and revocable. Accepted, expired, and revoked states were verified.
- Comment edits remain author-only; deletion remains author or owner/admin moderation.

### UI/UX and accessibility

- Invitation, project, and task dialogs now trap keyboard focus, close with Escape when safe, and restore focus to the invoking control.
- The mobile drawer now receives focus, contains forward/reverse Tab movement, closes with Escape, and restores focus after its exit animation.
- Session expiration from collaboration surfaces now gives the same redirect and feedback as workspace/project expiration.
- Empty, loading, error, permission, success, and failed-update treatments were reviewed through component tests and live workflows.
- Browser screenshots were inspected at 1440 × 1000, 768 × 900, 390 × 844, and 320 × 720. No tested view had horizontal overflow, out-of-bounds controls, runtime page errors, or axe WCAG 2.2 A/AA violations.
- The UI detector reported only the use of Inter. Inter is retained because the approved design system explicitly requires it.

## Fixes made in Stage F

1. Added safe 413 handling for oversized JSON payloads.
2. Added bounded login and registration throttling using `express-rate-limit`.
3. Added production rejection of the example session secret.
4. Added a host-bound production session-cookie name and high cookie priority.
5. Added shared modal focus management and mobile-drawer focus restoration.
6. Added immediate frontend session expiration for protected API 401 responses.
7. Added a no-referrer document policy to reduce invitation-token leakage through navigation referrers.
8. Added the integrated `stage-f:qa` PostgreSQL/browser workflow and focused regression tests.
9. Removed dashboard state-preview controls from production builds and replaced prototype-only error copy.

## Verification results

| Check | Result |
| --- | --- |
| Frontend tests | 7 files, 32 tests passed |
| Backend tests | 4 files, 15 tests passed |
| Backend suite under UTC | 15 passed |
| Backend suite under America/Los_Angeles | 15 passed |
| Backend suite under Asia/Taipei | 15 passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed; 1,947 modules transformed |
| Backend production build | Passed |
| Frontend dependency audit | 0 known vulnerabilities |
| Backend dependency audit | 0 known vulnerabilities |
| Real PostgreSQL Stage F workflow | Passed |
| Axe WCAG 2.2 A/AA checks | 0 violations in seven captures |
| Horizontal overflow | 0 at all captured widths |
| Temporary accounts remaining | 0 |
| Duplicate Vite server on 5174 | None |

## Evidence

Generated QA reports and temporary responsive captures remain local. The public repository includes curated views of the [dashboard](./docs/images/dashboard.png), [project detail](./docs/images/project-management.png), [Kanban board](./docs/images/kanban.png), and [team management](./docs/images/team-collaboration.png).

## Remaining risks

- The authentication limiter uses process memory. Limits are not shared across multiple API instances and reset when the process restarts.
- Exact Origin validation plus SameSite=Lax protects the current browser/API architecture. A future same-site multi-subdomain deployment or third-party frontend changes would require a fresh CSRF threat model and may warrant synchronizer tokens or a dedicated custom-header scheme.
- Invitation tokens necessarily appear in acceptance URLs and browser history. They are high-entropy, expiring, revocable, single-use, absent from application logs, hidden from list APIs, hashed in PostgreSQL, and now protected by a no-referrer document policy.
- The API has generic console error logging rather than structured, centrally redacted production telemetry.
- SMTP transport code is implemented, but no live provider credentials were available; no real invitation email is claimed as sent.
- This review did not include load, concurrency, denial-of-service, penetration, backup/restore, or disaster-recovery testing.

## Deployment blockers

1. Configure and verify a real SMTP provider, sender identity, bounce handling, and delivery observability.
2. Terminate TLS, confirm the exact reverse-proxy hop count assumed by `trust proxy`, and prevent direct bypass of that proxy.
3. Configure production frontend headers at the static host/CDN, including a tested Content Security Policy, HSTS, frame restrictions, MIME protections, and caching rules.
4. Move authentication throttling to a shared store before running more than one API instance.
5. Use managed production secrets and rotation for `SESSION_SECRET`, database credentials, and SMTP credentials; never copy `.env.example` values.
6. Require encrypted PostgreSQL transport where the database is not on the same trusted host, and complete backup/restore and migration rollback rehearsals.
7. Add production monitoring, structured redacted logs, uptime checks, alerting, and session-store maintenance.
8. Decide and implement account verification, password recovery, abuse response, and administrative support procedures.
9. Run an external security review and deployment-environment test before exposing the application publicly.

## Recommended next process

Resolve the deployment blockers in an environment-specific deployment plan. Re-run automated tests and `npm run stage-f:qa` against the release candidate, then perform smoke tests through the real HTTPS origin, proxy, PostgreSQL connection, shared rate-limit store, and SMTP provider. Do not treat local Stage F completion as production approval.

Stage F is complete and stopped for review before deployment.
