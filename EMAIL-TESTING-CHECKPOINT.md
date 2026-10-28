# ProjectFlow Email Testing Checkpoint

Date: 2026-10-28
Scope: isolated verification, recovery, invitation, outbox, and browser workflow testing without a purchased sending domain

## Status

ProjectFlow now has a local-only email testing architecture that exercises the real authentication-token rules and AES-256-GCM PostgreSQL outbox without returning bearer links through HTTP. The capture transport exists only in test-support source files, is excluded from the production backend compilation, and is guarded by a Render artifact scan.

No Render setting, Resend credential, Neon record, DNS record, Git commit, push, or deployment was changed. Resend remains the production provider.

## Architecture

`CapturingEmailDelivery` implements the existing delivery interface for tests and stores invitation, verification, and password-reset messages only in process memory. Its send methods return `{ "status": "sent" }` without a preview URL. Tests retrieve a message once by kind and recipient; retrieval removes it, and teardown clears anything left.

The browser harness:

1. Refuses any PostgreSQL hostname other than `localhost`, `127.0.0.1`, or `::1`.
2. Creates a cryptographically random `projectflow_email_qa_*` schema in the local ProjectFlow database.
3. Applies the five existing SQL migrations inside that schema.
4. Starts the real Express application with email verification required, a memory session store, the compiled Vite SPA, the real encrypted outbox, and the test-only capture transport.
5. Drains messages through the real `processNextOutboxMessage` claim/decrypt/delete path.
6. Drives the application with headless Microsoft Edge.
7. Closes the browser and server, clears captured messages, drops only the random QA schema, and verifies the schema is gone.

The test transport has no environment selector, HTTP route, inbox page, filesystem mailbox, API response field, or production server import.

## Security boundaries

- Production configuration still accepts only exact `INVITATION_DELIVERY=resend` or `smtp`; preview remains forbidden.
- Render Free continues to use the Resend HTTPS API.
- Production rejects `INVITATION_FROM` values on Resend's shared `@resend.dev` testing domain.
- `backend/tsconfig.build.json` excludes `*.test.ts` and `*.test-support.ts`.
- `scripts/verify-render-build.mjs` scans compiled backend JavaScript and fails if `PROJECTFLOW_TEST_EMAIL_CAPTURE` appears.
- Verification and reset tokens remain SHA-256 hashes in `auth_tokens`; invitation tokens remain SHA-256 hashes in `workspace_invitations`.
- Outbox payloads remain AES-256-GCM envelopes and do not expose recipients or bearer URLs at rest.
- Browser/API response capture, application logs, browser console output, local storage, session storage, and cookies are checked against every bearer token used by the QA run.

## Automated browser coverage

The command below passed against isolated local PostgreSQL:

```powershell
npm --prefix backend run verify:email:browser
```

It verified:

- registration queues an encrypted verification message;
- unverified accounts cannot use workspace APIs;
- verification token hashing, expiry, successful confirmation, and replay rejection;
- session restoration after reload;
- workspace, project, and task creation and persistence;
- accessible Kanban movement and persisted task status;
- invitation token hashing, queued delivery, matching-account acceptance, expiry, invalid-token handling, and replay rejection;
- collaboration comments and cross-workspace isolation;
- password-reset expiry, successful reset, single use, and invalidation of older sessions;
- login with the replacement password, logout, and anonymous access rejection;
- absence of bearer tokens from API responses, application logs, browser console output, local storage, session storage, and cookies;
- removal of the temporary PostgreSQL schema after the run.

Focused unit coverage also verifies that captured messages return no preview URL, are consumed once, can be cleared, and reject non-loopback database configuration.

## Production Resend outbox review

The live Neon inspection selected only grouped metadata (`kind`, attempts, safe `last_error`, readiness, expiry, lock state, and count). It did not select or decrypt `payload`, inspect recipients, retrieve tokens, or execute any write.

Earlier inspection found two unexpired, unlocked email-verification jobs at four attempts with `last_error=ResendApiError`. The fresh metadata-only inspection for this checkpoint returned zero outbox rows. ProjectFlow's existing worker deletes successful, expired, or five-times-failed rows, so automatic fifth-attempt abandonment or later expiry is consistent with the observed transition; absence alone cannot prove which event removed them. This work did not retry or remove either row.

Do not reconstruct or retrieve the old bearer tokens from Neon. After the sender is corrected, each affected user can sign in and use **Resend verification email**. That normal application route issues a new time-limited token, consumes any older active verification token, and queues a new encrypted message. Do not edit `auth_tokens` or `email_outbox` manually.

## Configuration

Local browser QA requires:

- local PostgreSQL running;
- ignored `backend/.env` containing a loopback `DATABASE_URL`;
- Microsoft Edge at the documented default path, or an `EDGE_PATH` override;
- an existing compiled frontend (`npm run build:all` creates it).

Production Render requires:

- `INVITATION_DELIVERY=resend`;
- an active sending-capable `RESEND_API_KEY`;
- `INVITATION_FROM` using a Resend-verified custom domain;
- the existing `EMAIL_OUTBOX_KEY`, `DATABASE_URL`, session, origin, proxy, and verification settings.

There is intentionally no `capture`, `mailbox`, or token-preview production environment variable.

## Verification evidence

- Capture transport tests: 2/2 passed.
- Browser-helper tests: 2/2 passed.
- Browser workflow: all eight check groups, including browser-storage secrecy, passed twice consecutively after the final synchronization fix.
- Browser cleanup check: zero `projectflow_email_qa_*` schemas remained.
- Frontend tests: 37/37 passed; backend tests: 76/76 passed.
- Frontend and backend TypeScript checks passed.
- Production frontend/backend build, production-bundle verification, and Render-build verification passed.
- Root and backend dependency audits: zero vulnerabilities.
- An intentional compiled marker probe was rejected by the Render artifact verifier; the clean backend build contained no capture marker.

Full frontend/backend suites, production builds, and audits are recorded after the final verification pass below.

## Remaining production limitation

Local capture proves ProjectFlow's application behavior but cannot make Resend's shared testing sender deliver to arbitrary public recipients. Live registration, invitation, and recovery email still require a Resend-verified custom domain and a matching `INVITATION_FROM`. Provider acceptance, inbox receipt, bounce, complaint, and suppression handling remain hosted-only checks.

## Synchronization boundary

The user authorized committing and pushing this verified change set to `main`. That synchronization does not alter Render settings, trigger a manual deploy, or authorize any production credential, database, or infrastructure change. The final synchronization and GitHub Actions result are reported separately because they occur after this checkpoint is committed.
