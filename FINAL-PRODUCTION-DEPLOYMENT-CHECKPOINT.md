# ProjectFlow — Final Production Deployment Checkpoint

Date: 2026-10-29 (Asia/Taipei)

## Release identity

- Repository: `Yukiiii2/projectflow`
- Previous attempted release commit: `c4a99ab20565c135a8f11ffe84dd2e7211dfb150`
- Portfolio-policy application release commit: `f68d5ed259a200db4ff800cc1064009680c3f85e`
- GitHub Actions run `40748716121` completed successfully with all six jobs green: frontend, backend build, three backend timezone test jobs, and PostgreSQL migration/recovery verification.

## Neon migration

- Migration `006_portfolio_demo.sql` was already applied once through the direct migration connection and was not re-run during this continuation.
- A release-time read-only query through the direct connection confirmed exactly six ledger entries (`001` through `006`) and exactly one `006_portfolio_demo.sql` row.
- Existing production row-count baselines and runtime/migration role separation were previously verified after the migration.

## Render deployment

- Service: `projectflow` (Render Free, Singapore)
- Public URL: <https://projectflow-s6xo.onrender.com>
- Historical failed deploy: `dep-dbh3r52fngtc73fasdl0` at `c4a99ab20565c135a8f11ffe84dd2e7211dfb150`; the strict sender gate correctly rejected the testing-only `resend.dev` sender.
- Portfolio-mode deploy: `dep-dbh49lo8v5cc73ech2lg` at `f68d5ed259a200db4ff800cc1064009680c3f85e`; result **Live**.
- Demo-activation restart: `dep-dbh4aigu01pc73fhipu0` at the same application commit; result **Live**.
- `/api/health` repeatedly returned HTTP 200 with `{"status":"ok"}`. The public root returned HTTP 200, an unauthenticated session check returned HTTP 401, and startup/deployment logs contained no relevant unexpected error.
- Live availability headers confirmed portfolio mode and demo mode enabled, with ordinary registration disabled.
- Live policy probes confirmed registration and password-recovery requests return HTTP 503 with `PORTFOLIO_EMAIL_DISABLED` before creating records.

## Demo activation

- `DEMO_MODE_ENABLED` remained false until the portfolio-mode release was Live and healthy, then was explicitly set to true.
- A headless live-browser smoke test used the public Try Live Demo CTA, created one private disposable session, loaded the realistic seeded dashboard, changed a seeded task, and confirmed the title/status change persisted after refresh.
- Logout returned HTTP 204 and the same browser session subsequently received HTTP 401.
- A read-only query for the exact disposable demo instance returned zero rows after logout, confirming temporary production records were cleaned up.
- The live browser reported no console or page errors during the smoke test. No ordinary user record or existing production workspace was modified.

## Historical blocker and selected recovery

The release intentionally refuses to start with Resend's shared testing sender. This matches the deployment runbook and production-readiness regression test. The safe recovery options were:

1. Verify a custom sending domain in Resend and change `INVITATION_FROM` on Render to a sender on that verified domain, preserving `INVITATION_DELIVERY=resend`; or
2. Approve a separately reviewed product/configuration change that explicitly defines how normal production registration email should behave without a verified domain.

The production guard must not be bypassed merely to activate the portfolio demo, because ordinary registration, verification, invitations, and password recovery would otherwise remain knowingly misconfigured.

The approved recovery is option 2: the explicit portfolio policy below. The testing-only sender remains invalid in normal production mode; it is not being treated as an unrestricted production sender.

## Portfolio email policy implementation

The recovery path selected on 2026-10-29 is an explicit portfolio policy rather than weakening Resend validation:

- `PORTFOLIO_MODE_ENABLED` is opt-in and defaults to false.
- When enabled, production uses a disabled email transport and does not start the outbox worker.
- Ordinary registration, password recovery requests, verification resend, and new external email invitations return HTTP 503 before creating users, tokens, invitation rows, or outbox jobs.
- Existing login, sessions, protected APIs, email verification requirements, and already-issued verification/reset/invitation links remain intact.
- Normal production mode still requires Resend/SMTP and rejects the shared `resend.dev` sender.
- The frontend receives boolean availability headers only and removes unavailable controls while directing visitors to the isolated live demo.

## Local verification of the portfolio policy

- Frontend tests: 51 passed.
- Backend tests: 98 passed across 14 files, including the final production-transport guard test.
- Frontend and backend TypeScript checks: passed.
- Combined production and Render build verification: passed.
- Production dependency audits: zero known vulnerabilities at the configured high-severity threshold.
- Real-browser QA against an isolated PostgreSQL schema: passed at six responsive landing-page breakpoints and covered portfolio messaging, registration/recovery rejection, demo workflows, task editing, comments, Kanban persistence, visitor isolation, privileged-action blocking, expiry, logout cleanup, rate limiting, accessibility, and browser/network/response hygiene.
- The browser harness initially selected an expiry target by ambiguous creation-time ordering. It was corrected to map the disposable demo through the authenticated session user ID; focused application expiry tests continued to pass, and the full browser run then passed.
- Post-run cleanup check: zero isolated `pf_email_qa_*` schemas remained in the local PostgreSQL instance, and all test servers and browser contexts were stopped.

All local, CI, migration-ledger, Render health, staged activation, and disposable cleanup gates passed. Migration 006 remains untouched during this release continuation.

## Remaining limitations and recovery position

- Ordinary public registration, verification resend, password-recovery requests, and new external email invitations are intentionally unavailable while portfolio mode is enabled.
- The existing Resend testing sender remains unsuitable for arbitrary recipients. Restoring normal email workflows requires a verified sender/domain and working provider before setting `PORTFOLIO_MODE_ENABLED=false`.
- Render Free can cold-start after inactivity; Neon Free and Render Free quotas still apply.
- Roll back in this order: set `DEMO_MODE_ENABLED=false`; if necessary, roll back the application deploy. Do not disable portfolio mode until a verified email provider configuration is ready, because the production startup guard will correctly fail closed.
- Neon migration 006 is current and must not be re-applied or rolled back as part of an application rollback.
- Existing authentication, Resend secret values, Neon records, and existing encrypted outbox rows were not altered by the release.
