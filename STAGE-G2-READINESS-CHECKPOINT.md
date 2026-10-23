# ProjectFlow Stage G2 — Deployment Readiness Checkpoint

**Date:** 2026-10-22
**Status:** Local implementation and verification complete; live deployment remains blocked pending explicit approval and provider configuration.

## Scope and outcome

Stage G2 implements the production-readiness work identified in the Stage G1 plan for the approved architecture: one Render Node service serving Express and the compiled Vite application, Neon PostgreSQL over TLS, Resend SMTP, and GitHub Actions CI.

No cloud resources were created, no DNS was changed, no application was deployed, and no production or existing local data was reset. Provider-specific behavior remains a hosted verification gate.

## Implemented changes

### Single-service production serving

- Express serves the compiled root `dist/` directory in production.
- `/api` routes and the API JSON 404 handler take precedence over static assets and the SPA fallback.
- Client-side deep links return `index.html` with `no-cache`; hashed assets receive immutable caching.
- The production frontend uses same-origin API requests. The local `http://localhost:4000` fallback is development-only and is absent from the production bundle.
- A Render Blueprint builds both packages, starts the compiled backend, uses `/api/health`, and keeps automatic deployment disabled.

### Safe database migrations

- `schema_migrations` records the migration name, SHA-256 checksum, and application time.
- A PostgreSQL advisory lock prevents concurrent migration runners.
- Numbered migrations execute in lexical order inside runner-managed transactions.
- Applied migrations are skipped and a changed checksum fails closed.
- Embedded transactions were removed from migrations 001 and 002 so the runner owns rollback behavior.
- Migration 003 adds account verification, session-version invalidation, and hashed-purpose authentication tokens. Existing accounts are deliberately marked verified to avoid locking out established users.
- Migration 004 moves the session table under migration control, enforces one outstanding token per user and purpose, and adds a durable production email outbox. Migration 005 adds bounded outbox retention.

### Production security and configuration

- Startup validation rejects missing, malformed, placeholder, or unsafe production configuration.
- Production requires an HTTPS frontend origin, a TLS PostgreSQL URL, a strong session secret, SMTP configuration, and email verification.
- Explicit Helmet policy includes CSP, HSTS, clickjacking protection, MIME sniffing protection, and a strict referrer policy.
- Production trusts a configurable bounded proxy-hop count, redirects safe HTTP requests to HTTPS, and rejects insecure state-changing requests.
- Exact-Origin and Fetch Metadata checks protect state-changing routes.
- Session cookies remain `HttpOnly`, `SameSite=Lax`, and become `Secure` in production.
- Recovery endpoints use bounded token lifetimes, SHA-256 token storage, transactional token replacement, single-use consumption, uniform response bodies, a production response-time floor, and session invalidation after password reset.
- Production invitations, verification, and password recovery use source-record/outbox transactions. AES-256-GCM encrypts queued payloads with an independent key. The worker applies bounded SMTP timeouts and backoff; successful, expired, and five-times-failed messages are deleted.

### Logging, health, and monitoring preparation

- Structured JSON request logs contain request ID, method, redacted path, status, duration, and `CF-Ray` when present.
- Sensitive query values, credentials, tokens, cookies, and request bodies are not logged.
- `X-Request-ID` is returned to clients and `/api/health` remains the non-mutating Render health check.
- The deployment runbook identifies external uptime monitoring and provider alert configuration as manual hosted steps.

### Frontend account lifecycle

- Added forgot-password, reset-password, and verify-email flows using the approved ProjectFlow authentication layout.
- Verification gating follows the server policy flag, so local environments with optional verification remain usable.
- Password reset success returns the user to sign-in; expired or invalid tokens produce clear errors.
- Desktop and mobile recovery layouts retain visible labels, focus styles, minimum touch targets, and responsive behavior.

### Continuous integration and operations documentation

- GitHub Actions now runs frontend tests, typechecks, builds, and high-severity audits.
- Backend tests run under UTC, America/Los_Angeles, and Asia/Taipei before backend typecheck, build, and audit jobs.
- Added a deployment runbook and database backup, recovery, migration failure, and rollback procedures.
- Updated environment examples and README files with actual commands, production architecture, security behavior, and remaining limits.

## Verification evidence

### Automated tests

- Frontend: **8 files, 37 tests passed**.
- Backend in UTC: **8 files, 39 tests passed**.
- Backend in America/Los_Angeles: **8 files, 39 tests passed**.
- Backend in Asia/Taipei: **8 files, 39 tests passed**.
- Focused coverage includes production configuration, static/API precedence, redirect host safety, security headers, HTTPS enforcement, request logging/redaction, migration locking/checksums/rollback/cleanup, hashed authentication tokens, concurrent token replacement, verification gating, password reset, session invalidation, durable email delivery, and frontend recovery flows.

### TypeScript, builds, and dependencies

- Frontend TypeScript check passed.
- Backend TypeScript check passed.
- Combined production build passed: Vite transformed 1,948 modules and the backend compiled with its production TypeScript configuration.
- Frontend dependency audit: **0 vulnerabilities** at the high-severity gate.
- Backend dependency audit: **0 vulnerabilities** at the high-severity gate.
- `git diff --check` passed; the only output was Git's existing line-ending normalization notice for `src/styles.css`.
- Production bundle scan found no local API URL, prototype preview label, or prototype-control label.

### Real PostgreSQL and browser verification

- Migration runner against the existing local PostgreSQL database applied migrations 004 and 005 once; the final repeat run reports **0 applied, 5 already current**.
- A real PostgreSQL verifier confirmed all five ledger entries and serialization of concurrent runners.
- A temporary-account PostgreSQL check verified hashed recovery tokens, verification gating, password reset, old-session invalidation, old-password rejection, new-password login, consistent lock ordering during concurrent confirmation/resend, encrypted outbox delivery, source/outbox rollback, successful-job deletion, and cleanup.
- The full Stage F browser journey was rerun successfully against the real local database. It covered registration, sessions, workspace boundaries, projects, tasks, Kanban, invitations, comments, keyboard/accessibility checks, and responsive layouts.
- New account-recovery screens passed Axe WCAG 2 A/AA/2.1 AA/2.2 AA checks and overflow checks at 1,440px and 390px. Manual screenshot inspection found no clipping or visual regressions.

### Production-mode boundary

Production static routing, headers, HTTPS behavior, and configuration failure modes are verified through isolated production-mode integration tests. A full local production server cannot connect to the current non-TLS local PostgreSQL service when production TLS enforcement is enabled; it fails before listening as intended. A complete running production smoke test therefore requires the approved Neon TLS connection and Render proxy/HTTPS environment.

## Required environment variables

### Secrets set only in Render

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Neon pooled PostgreSQL URL with `sslmode=require`, `verify-ca`, or `verify-full` |
| `SESSION_SECRET` | Cryptographically random value of at least 32 characters |
| `SMTP_PASSWORD` | Resend SMTP/API credential |
| `EMAIL_OUTBOX_KEY` | Independent canonical base64 value encoding 32 random bytes |
| `INVITATION_FROM` | Sender using a Resend-verified domain |
| `FRONTEND_ORIGIN` | Exact public HTTPS origin; while not secret, set it for the chosen Render/custom domain |

### Non-secret production configuration

| Variable | Planned value |
| --- | --- |
| `NODE_ENV` | `production` |
| `TRUST_PROXY_HOPS` | `1`, subject to hosted topology verification |
| `REQUIRE_EMAIL_VERIFICATION` | `true` |
| `INVITATION_DELIVERY` | `smtp` |
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` |
| `INVITATION_TTL_HOURS` | `168` |
| `VERIFICATION_TTL_MINUTES` | `1440` |
| `PASSWORD_RESET_TTL_MINUTES` | `60` |
| `LOG_LEVEL` | `info` |

`PORT` is supplied by Render. Do not set `VITE_API_URL` for the same-origin production build. The committed examples and `render.yaml` contain placeholders or `sync: false` declarations only.

## Manual configuration and deployment gates

These steps require explicit deployment approval:

1. Create a Neon project near Render Singapore and obtain its pooled TLS connection string.
2. Create a Neon branch or restore point, run the migration runner once from a protected environment, and verify the migration ledger.
3. Verify a sending domain in Resend and publish its SPF/DKIM records.
4. Create the Render service from `render.yaml`, review the Starter plan, and enter secrets directly in Render.
5. Confirm the exact HTTPS origin, proxy-hop behavior, secure session cookies, CSP/HSTS headers, database TLS, and API/static routing through Render.
6. Send and receive invitation, verification, and reset messages without copying tokens into logs.
7. Configure an external uptime probe for `/api/health` plus Render/Neon/Resend alerts.
8. Execute the documented backup/restore rehearsal against a disposable Neon branch.
9. Run the full browser workflow against the hosted release candidate before enabling public registration or automatic deployment.
10. Enable Render deploys after successful GitHub checks only after the first manual release and rollback rehearsal pass.

## Remaining blockers and risks

- Render, Neon, and Resend credentials or resources have not been created or tested.
- Live SMTP delivery, sender DNS, bounce handling, and provider quotas remain unverified.
- Render proxy hops, HTTPS redirects, secure cookie behavior, CSP/HSTS delivery, and Neon TLS must be verified through the public origin.
- CI configuration is locally reviewed and its equivalent commands pass, but GitHub Actions has not run the new workflow until these changes are pushed.
- Rate limiting remains process-local and is suitable only for the approved single-instance portfolio service. Horizontal scaling requires a shared store.
- Automated logical backup exports and hosted restore rehearsal are not configured. The documented Neon branch/restore and `pg_dump` procedure must be exercised before storing non-recreatable data.
- Monitoring provider selection, alert recipients, retention, and privacy review remain manual choices.
- There has been no external penetration test, load test, denial-of-service test, or production incident drill.
- Workspace ownership transfer remains outside the current product scope and should be resolved before supporting long-lived organizations.

## Deployment readiness assessment

**Ready for a controlled, manual hosted release candidate after explicit approval.** The local code, migrations, account lifecycle, CI definition, runbooks, and production guardrails are implemented and verified. The application is not yet approved for unrestricted public registration or production claims because provider credentials, live email, Render/Neon network behavior, monitoring, and recovery procedures require hosted verification.

## Files added

- `.github/workflows/ci.yml`
- `render.yaml`
- `backend/sql/003_account_security.sql`
- `backend/sql/004_runtime_operations.sql`
- `backend/sql/005_email_outbox_retention.sql`
- `backend/src/auth-tokens.ts`
- `backend/src/config.ts`
- `backend/src/email-outbox.ts`
- `backend/src/logger.ts`
- `backend/src/migrations.ts`
- `backend/src/auth-security.test.ts`
- `backend/src/migrations.test.ts`
- `backend/src/production-readiness.test.ts`
- `backend/src/email-outbox.test.ts`
- `backend/src/verify-migrations-postgres.ts`
- `backend/src/verify-live-readiness.ts`
- `src/auth/AccountRecoveryPage.tsx`
- `src/auth/api.test.ts`
- `docs/DEPLOYMENT-RUNBOOK.md`
- `docs/DATABASE-RECOVERY.md`
- `STAGE-G2-READINESS-CHECKPOINT.md`

## Files updated

- `.env.example`
- `README.md`
- `package.json`
- `package-lock.json`
- `src/App.tsx`
- `src/auth/AuthContext.tsx`
- `src/auth/AuthFlow.test.tsx`
- `src/auth/AuthPage.tsx`
- `src/auth/RouteGuards.tsx`
- `src/auth/api.ts`
- `src/collaboration/api.ts`
- `src/collaboration/TeamPage.tsx`
- `src/styles.css`
- `backend/.env.example`
- `backend/README.md`
- `backend/package.json`
- `backend/sql/001_init.sql`
- `backend/sql/002_collaboration.sql`
- `backend/src/app.ts`
- `backend/src/app.test.ts`
- `backend/src/collaboration.ts`
- `backend/src/collaboration.test.ts`
- `backend/src/db.ts`
- `backend/src/invitation-delivery.ts`
- `backend/src/migrate.ts`
- `backend/src/server.ts`

The existing `STAGE-G1-DEPLOYMENT-PLAN.md` is preserved as the approved planning input. Stage G2 stops here; no live deployment has been attempted.
