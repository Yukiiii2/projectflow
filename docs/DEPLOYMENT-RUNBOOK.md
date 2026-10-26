# ProjectFlow deployment runbook

This runbook prepares the approved single-service architecture. It does not authorize a deployment. Complete the Stage G2 checkpoint and obtain explicit approval before creating resources or applying these steps to a public environment.

## Architecture

- One Render Node web service serves the compiled Vite `dist/` directory and Express `/api` routes.
- Neon provides PostgreSQL through a pooled connection with TLS required.
- Resend supplies transactional email through its HTTPS API, which is compatible with Render Free's SMTP restrictions.
- Node.js 24 LTS is used by local tooling, GitHub Actions, and Render.
- GitHub Actions runs tests, typechecks, builds, and high-severity dependency audits.
- Render auto-deploy remains off until the first manual hosted verification succeeds.

## Preflight

1. Confirm `main` passes the GitHub Actions workflow.
2. Run the complete local commands documented in the repository README.
3. Confirm the production bundle contains no `http://localhost:4000`, `Preview state`, secrets, or `.env` content.
4. Confirm `render.yaml` contains only placeholders and non-secret configuration.
5. Rehearse the database procedure in [DATABASE-RECOVERY.md](./DATABASE-RECOVERY.md).
6. Confirm the CI PostgreSQL job completed both concurrent migration verification and the isolated `pg_dump`/`pg_restore` recovery rehearsal.
7. Record the exact reviewed commit. Do not deploy a moving branch or an unreviewed working tree.

## Provider preparation requiring approval

1. Create a Neon project in the region nearest Render Singapore. Protect the production branch, choose and record history retention, define connection limits, and use separate runtime/migration roles where the selected plan supports them.
2. Copy the **pooled** connection string for Render's runtime `DATABASE_URL` and confirm it ends with `sslmode=require` or a stronger verification mode. Store the direct, non-pooler TLS URL separately for the operator-only `MIGRATION_DATABASE_URL`; ProjectFlow migrations use a session advisory lock that is incompatible with transaction pooling.
3. Create a Neon snapshot or recovery branch, restore it to a separate branch, and complete the database runbook before accepting non-recreatable data.
4. Create a Resend account, approve a sending domain, and publish the exact SPF/DKIM records Resend provides. Create a sending-only key restricted to the production domain where available; Resend supports sending-scoped API keys ([Resend API key permissions](https://resend.com/changelog/new-api-key-permissions)).
5. Confirm the sender identity matches `INVITATION_FROM`, then test the Resend HTTPS email API. Each outbox row supplies a stable idempotency key, which Resend retains for 24 hours to prevent duplicate sends during retries ([Resend idempotency keys](https://resend.com/changelog/idempotency-keys)).
6. Create a Render Blueprint from this repository. Review the proposed Free service, Node.js 24, build/start commands, `/api/health`, environment values, region, and plan before applying it. Accept the documented cold-start, quota, outbound-traffic, no-shell, and ephemeral-filesystem limits ([Render Free limitations](https://render.com/docs/free)).
7. Keep automatic deploys disabled. Render supports waiting for CI checks before automatic deploys, but enable that only after the first manual release and rollback rehearsal pass ([Render deploys](https://render.com/docs/deploys)).

## Render variables

Set secret fields directly in Render. Never place them in GitHub, chat, screenshots, shell output, or `render.yaml`.

- `DATABASE_URL`: Neon pooled TLS URL.
- `SESSION_SECRET`: at least 32 random characters; 48 random bytes encoded as Base64 is recommended.
- `FRONTEND_ORIGIN`: exact final HTTPS origin without a trailing slash.
- `RESEND_API_KEY`: sending-only Resend API key, restricted to the verified production domain where available.
- `EMAIL_OUTBOX_KEY`: independent canonical base64 encoding of 32 random bytes, used for AES-256-GCM queued-email payloads.
- `INVITATION_FROM`: verified sender such as `ProjectFlow <invites@example.com>`.

The Blueprint supplies non-secret values for Node.js 24, `NODE_ENV`, proxy hops, token lifetimes, `INVITATION_DELIVERY=resend`, and log level. Do not add `MIGRATION_DATABASE_URL` to the Render web service: it belongs only in the protected operator environment while migrations run.

## Initial release sequence

1. Create a Neon restore point or branch.
2. In a protected operator environment, set `NODE_ENV=production` and `MIGRATION_DATABASE_URL` to Neon's direct, non-pooler TLS URL, then run `npm --prefix backend run db:migrate`. Do not echo the URL.
3. Run the migration command a second time and confirm it reports all files already current.
4. Deploy manually from the reviewed `main` commit.
5. Confirm `/api/health` returns `{"status":"ok"}` through HTTPS.
6. Inspect the response CSP, HSTS, frame, MIME, referrer, and cache headers.
7. Confirm the session cookie is named `__Host-projectflow.sid` and has `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` without `Domain`.
8. Complete registration, email verification, session refresh, workspace, project, task, Kanban, invitation, comment, password reset, logout, and sign-in checks using synthetic records.
9. Verify direct cross-workspace requests return nondisclosing 404 responses.
10. Verify invitation, verification, and reset delivery through the Resend HTTPS API without copying tokens into logs.
11. Confirm `email_outbox` drains after successful deliveries and retries provider failures without logging payloads.
12. Remove only the isolated test records and confirm no temporary accounts remain.
13. Configure an external uptime check for `/api/health` and an error-monitoring project.

Drain or deliberately purge the outbox before rotating `EMAIL_OUTBOX_KEY`; queued rows encrypted with the previous key cannot be decrypted with the replacement.

## Rollback

- Application rollback: select the last verified Render deploy. Do not roll back application code across an incompatible schema boundary.
- Database rollback: restore to a Neon branch or point in time, verify it privately, then promote or change the connection only after reviewing data loss since the restore point.
- Secrets: rotate the affected credential in its provider and Render. Rotating `SESSION_SECRET` invalidates all sessions.
- Email: revoke the Resend key, issue a new least-privilege key, and verify delivery before re-enabling public actions.

Database migrations remain a protected operator step. `render.yaml` deliberately does not run them at application startup or automatically on every instance. Render Free has no shell or one-off jobs, so run migrations from the trusted local operator environment with `MIGRATION_DATABASE_URL`; never substitute the pooled runtime URL. A future paid-service pre-deploy command can be considered only after hosted backup/restore and migration-role verification.

## Monitoring and maintenance

- Alert on failed health checks, deploy failures, repeated 5xx responses, unusual 401/403/429 volume, database limits, and email delivery failures.
- Alert on the structured `email_outbox_delivery_abandoned` event. It means a queued invitation, verification, or reset message exhausted five transport attempts and was deleted; logs identify only the internal message ID, message kind, error class, and attempt count.
- Logs are structured JSON and include request ID, method, redacted path, status, duration, and Cloudflare Ray ID where available. Bodies, cookies, credentials, and tokens are not logged.
- Keep one API instance while rate limits use memory. Add a shared Redis-compatible rate-limit store before horizontal scaling.
- Remove expired sessions and auth tokens on a scheduled maintenance job after hosted behavior is established.
- Review dependency alerts weekly and repeat the security/browser workflow after cookie, proxy, CSP, authentication, or infrastructure changes.

### Minimum alert routing

| Signal | Source | Initial threshold | Required response |
| --- | --- | --- | --- |
| `/api/health` unavailable | External HTTPS probe and Render | Two consecutive failures; tune after observing hosted behavior | Page the application owner, inspect deploy/database state, pause releases |
| Deploy/build/pre-deploy failure | Render | Any failure | Keep prior release active, review logs, do not bypass migration checks |
| Repeated 5xx or `request_failed` | Structured application logs | Alert on a sustained cluster, not a single expected test error | Correlate by request ID; inspect sanitized error class and route |
| `email_outbox_delivery_abandoned` | Structured application logs | Any event | Check Resend/provider status and affected message kind; never log the recipient or bearer URL |
| Abnormal 401/403/429 volume | Structured application logs | Baseline-dependent | Check abuse, proxy IP attribution, and limiter behavior |
| Connection/storage/compute pressure | Neon | Provider warning threshold | Reduce load or raise capacity; verify pool and long-running queries |
| Bounce/complaint/suppression spike | Resend | Any provider warning or material increase | Pause affected mail, inspect sender/domain reputation and recipient policy |

Assign one named owner and one fallback contact for application, database, and email alerts before launch. Confirm test alerts reach both contacts, include the environment and runbook link, exclude secrets/personal data, and have a documented acknowledge/escalate/resolve path. The application already emits newline-delimited JSON to standard output; hosted verification must confirm Render preserves `timestamp`, `level`, `event`, request ID, status, duration, and redacted path fields.

## Final go/no-go checklist

A hosted release remains **no-go** until every item below has evidence:

- reviewed `main` commit and all required GitHub Actions checks are green;
- branch protection/check requirements are configured without granting pull-request jobs production secrets;
- Render Free Blueprint values, Node.js 24, exact HTTPS origin, proxy hop count, headers, secure cookie, static/API routing, health check, graceful shutdown, cold start, and outbound HTTPS are verified;
- Neon pooled runtime TLS connection, direct migration TLS connection, runtime/migration privileges, retention, snapshot/restore, logical-export storage, connection limits, and disposable-branch rehearsal are verified;
- Resend sending domain, SPF/DKIM, least-privilege key, invitation/verification/reset receipt, expiry/single use, bounce/complaint visibility, and credential rotation are verified;
- external uptime, structured-log ingestion, provider alerts, notification routing, and alert-response ownership are tested;
- actual recovery point and recovery time are measured and accepted;
- synthetic full workflow passes through the public HTTPS origin and all test data is removed;
- rollback decision owner and application/database/email rollback steps are approved.

Until then, keep `autoDeployTrigger: off`, do not add a migration startup hook, do not enable unrestricted public registration, and do not describe the service as production verified.
