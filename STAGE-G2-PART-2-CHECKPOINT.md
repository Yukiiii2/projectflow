# ProjectFlow Stage G2 — Email and Deployment Operations Readiness Part 2 Checkpoint

**Date:** 2026-10-26

**Baseline:** `f25a46474e7cc01ca48f003fb116312219e740c8` on synchronized `main`

**Status:** Part 2 implemented and locally verified; hosted email and monitoring verification remains pending explicit deployment approval

## Scope

This checkpoint covers only:

- Resend-compatible SMTP configuration and transport security;
- production email verification, invitation delivery, and password recovery readiness;
- encrypted PostgreSQL email-outbox processing and failure visibility;
- structured logging and bearer-token redaction;
- monitoring and environment-configuration readiness that can be verified without cloud credentials;
- focused tests, complete regression suites, TypeScript checks, production builds, and dependency audits.

No application was deployed. No Render, Resend, database-provider, monitoring, or paid service was created or configured. No DNS record or secret was added or changed.

## Implemented changes

### Invitation-token log redaction

- Structured request logging now redacts bearer tokens from frontend `/invite/<token>` routes as well as the existing API invitation-token routes.
- The regression test sends an actual request through Express and verifies the emitted JSON request log contains `/invite/[REDACTED]` and never the original token.
- Existing redaction for database credentials, authorization values, query strings, verification URLs, reset URLs, cookies, passwords, and token-named fields remains intact.

### Resend SMTP/TLS hardening

- Resend ports `465` and `2465` configure Nodemailer with implicit TLS.
- Resend ports `587` and `2587` configure Nodemailer with mandatory STARTTLS.
- Production rejects port `25`, unsupported ports, non-integer values, zero, and out-of-range values before creating the SMTP transport.
- The committed production configuration remains `smtp.resend.com`, port `465`, user `resend`, and a managed `SMTP_PASSWORD`; no credential is stored in the repository.
- Current installed email transport version: Nodemailer `10.1.7`.

### Terminal outbox failure logging

- A queued message that fails its fifth transport attempt is deleted immediately instead of receiving another retry schedule.
- The worker emits the error-level event `email_outbox_delivery_abandoned` with only the internal message ID, message kind, error class, and attempt count.
- Earlier failures retain bounded exponential backoff and now include the attempt count and retry delay in the warning event.
- Logs continue to exclude recipients, message bodies, encrypted payloads, credentials, and bearer URLs.
- The deployment runbook now identifies the terminal event as an alert condition.

## Existing email and account protections reverified

- Production requires SMTP delivery, email verification, a configured sender identity, and an independent canonical 32-byte base64 `EMAIL_OUTBOX_KEY`; provider-side sender verification remains a hosted gate.
- Registration, verification resends, password-reset requests, and workspace invitations write their source record and encrypted outbox message atomically.
- Queued payloads use AES-256-GCM and successful messages are deleted.
- Verification and password-reset tokens are random, stored only as SHA-256 hashes, bounded by expiry, and single-use.
- Only one unconsumed token per user and purpose remains active.
- Password reset increments the user's session version, invalidating sessions issued before the reset.
- Known and unknown password-reset requests return the same response; production also applies the configured response-time floor.
- Invitations remain expiring, revocable, single-use, tied to the invited email address, and authorized by workspace role.
- Recovery and invitation endpoints retain their existing Origin, Fetch Metadata, rate-limit, validation, and authorization protections.

## Verification evidence

| Check | Result |
| --- | --- |
| Focused readiness, delivery, outbox, authentication, and collaboration tests | 5 files, **35/35 passed** |
| Complete frontend suite | 8 files, **37/37 passed** |
| Complete backend suite | 8 files, **50/50 passed** |
| Real PostgreSQL readiness verifier | Passed with temporary-record cleanup |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Combined production build | Passed; Vite transformed **1,948 modules**, backend compiled |
| Production bundle scan | No local API URL, preview-state label, or prototype-controls label |
| Frontend high-severity dependency audit | **0 vulnerabilities** |
| Backend high-severity dependency audit | **0 vulnerabilities** |

The real PostgreSQL verifier confirmed hashed authentication tokens, verification gating, single-use password recovery, previous-session invalidation, replacement-token concurrency, encrypted outbox delivery, deletion after successful transport, atomic source/outbox rollback, and cleanup of its temporary records.

The backend suite and live readiness verifier intentionally exercise generic server-error paths; their structured `request_failed` events contain only the error class and no secret or request payload.

## Files changed

- `backend/.env.example`
- `backend/README.md`
- `backend/src/email-outbox.test.ts`
- `backend/src/email-outbox.ts`
- `backend/src/invitation-delivery.test.ts`
- `backend/src/invitation-delivery.ts`
- `backend/src/logger.ts`
- `backend/src/production-readiness.test.ts`
- `docs/DEPLOYMENT-RUNBOOK.md`
- `STAGE-G2-PART-2-CHECKPOINT.md`

No dependency, lockfile, SQL migration, frontend source, CI workflow, or Render Blueprint change was required.

## Hosted-only limitations and required verification

The following cannot be claimed from local verification and remain blocked until a separately approved hosted release-candidate phase:

1. Create a restricted Resend credential and verify the production sending domain through its required DNS records.
2. Confirm Render's selected paid service can connect to Resend over the configured SMTP port and TLS mode.
3. Send invitation, verification, and password-reset messages to controlled recipients and verify receipt, link behavior, expiry, single use, and sender authentication.
4. Inspect Resend delivery events for accepted, delivered, delayed, bounced, complained, and suppressed outcomes without copying bearer links into tickets or logs.
5. Decide whether provider webhooks are required after reviewing retention, privacy, signature verification, and operational ownership. No webhook receiver was added in Part 2.
6. Confirm Render log collection preserves JSON fields and configure an alert for `email_outbox_delivery_abandoned`, repeated worker failures, and unusual 5xx/401/403/429 volume.
7. Verify the external uptime probe and hosted `/api/health` behavior separately; SMTP delivery is deliberately not part of the health endpoint.
8. Run the complete account and collaboration journey through the real public HTTPS origin and inspect the deployed logs for token and credential redaction.

These are hosted verification gates, not locally reproducible defects.

## Stop boundary

Stage G2 Part 2 stops here. No deployment, cloud provisioning, DNS modification, paid-service configuration, provider credential use, or Stage G2 Part 3 work was performed.
