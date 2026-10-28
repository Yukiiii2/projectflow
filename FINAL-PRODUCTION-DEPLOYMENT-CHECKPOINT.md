# ProjectFlow — Final Production Deployment Checkpoint

Date: 2026-10-29 (Asia/Taipei)

## Release identity

- Repository: `Yukiiii2/projectflow`
- Previous attempted release commit: `c4a99ab20565c135a8f11ffe84dd2e7211dfb150`
- Local `HEAD` and `origin/main` matched this commit when the portfolio-policy recovery began.
- GitHub Actions run `40702230620` had already completed successfully with all six jobs green.

## Neon migration

- Migration `006_portfolio_demo.sql` was already applied once through the direct migration connection and was not re-run during this continuation.
- The production migration ledger contains exactly migrations `001` through `006`.
- Existing production row-count baselines and runtime/migration role separation were previously verified after the migration.

## Render deployment

- Service: `projectflow` (Render Free, Singapore)
- Public URL: <https://projectflow-s6xo.onrender.com>
- Attempted deploy: `dep-dbh3r52fngtc73fasdl0`
- Attempted source: `c4a99ab20565c135a8f11ffe84dd2e7211dfb150`
- Result: **failed during application startup** after a successful frontend/backend build.
- Exact safety gate: production rejected the configured testing-only `resend.dev` sender because `INVITATION_FROM` must use a Resend-verified custom domain.
- The previous deployment remains live at commit `2f02141b200c80be03b4c5c2d1ef54ac0d5a6b58`.
- The retained deployment still returns HTTP 200 with `{"status":"ok"}` from `/api/health`; protected workspace access returns HTTP 401 without a session.

## Demo activation

- `DEMO_MODE_ENABLED` was not enabled.
- Before the attempted release, `POST /api/auth/demo` returned HTTP 403, confirming demo mode remained disabled.
- No live demo session or temporary production record was created.
- Live smoke testing was not started because the release did not pass the startup/health gate.

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

Deployment remains pending until the final release matrix, GitHub Actions, staged Render portfolio activation, and disposable live demo cleanup all pass. Migration 006 must remain untouched.

## Recovery position

- Production traffic remains on the last successful Render release.
- Neon migration 006 is already current; do not reapply it.
- No Render environment value was changed during the failed-release investigation.
- No production data was changed.
