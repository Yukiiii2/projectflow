# ProjectFlow deployment runbook

This runbook prepares the approved single-service architecture. It does not authorize a deployment. Complete the Stage G2 checkpoint and obtain explicit approval before creating resources or applying these steps to a public environment.

## Architecture

- One Render Node web service serves the compiled Vite `dist/` directory and Express `/api` routes.
- Neon provides PostgreSQL through a pooled connection with TLS required.
- Resend supplies transactional email through SMTP.
- GitHub Actions runs tests, typechecks, builds, and high-severity dependency audits.
- Render auto-deploy remains off until the first manual hosted verification succeeds.

## Preflight

1. Confirm `main` passes the GitHub Actions workflow.
2. Run the complete local commands documented in the repository README.
3. Confirm the production bundle contains no `http://localhost:4000`, `Preview state`, secrets, or `.env` content.
4. Confirm `render.yaml` contains only placeholders and non-secret configuration.
5. Rehearse the database procedure in [DATABASE-RECOVERY.md](./DATABASE-RECOVERY.md).

## Provider preparation requiring approval

1. Create a Neon project in the region nearest Render Singapore.
2. Copy the **pooled** connection string and confirm it ends with `sslmode=require` or a stronger verification mode.
3. Create a Resend account, approve a sending domain, and publish its SPF/DKIM records.
4. Create a Render Blueprint from this repository. Review the proposed Starter service before applying it.
5. Keep automatic deploys disabled.

## Render variables

Set secret fields directly in Render. Never place them in GitHub, chat, screenshots, shell output, or `render.yaml`.

- `DATABASE_URL`: Neon pooled TLS URL.
- `SESSION_SECRET`: at least 32 random characters; 48 random bytes encoded as Base64 is recommended.
- `FRONTEND_ORIGIN`: exact final HTTPS origin without a trailing slash.
- `SMTP_PASSWORD`: Resend API key used as the SMTP password.
- `EMAIL_OUTBOX_KEY`: independent canonical base64 encoding of 32 random bytes, used for AES-256-GCM queued-email payloads.
- `INVITATION_FROM`: verified sender such as `ProjectFlow <invites@example.com>`.

The Blueprint supplies non-secret values for `NODE_ENV`, proxy hops, token lifetimes, email mode, Resend SMTP host/port/user, and log level.

## Initial release sequence

1. Create a Neon restore point or branch.
2. Run `npm --prefix backend run db:migrate` in a protected environment using the migration credential.
3. Run the migration command a second time and confirm it reports all files already current.
4. Deploy manually from the reviewed `main` commit.
5. Confirm `/api/health` returns `{"status":"ok"}` through HTTPS.
6. Inspect the response CSP, HSTS, frame, MIME, referrer, and cache headers.
7. Confirm the session cookie is named `__Host-projectflow.sid` and has `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` without `Domain`.
8. Complete registration, email verification, session refresh, workspace, project, task, Kanban, invitation, comment, password reset, logout, and sign-in checks using synthetic records.
9. Verify direct cross-workspace requests return nondisclosing 404 responses.
10. Verify invitation, verification, and reset delivery in Resend without copying tokens into logs.
11. Confirm `email_outbox` drains after successful deliveries and retries provider failures without logging payloads.
12. Remove only the isolated test records and confirm no temporary accounts remain.
13. Configure an external uptime check for `/api/health` and an error-monitoring project.

Drain or deliberately purge the outbox before rotating `EMAIL_OUTBOX_KEY`; queued rows encrypted with the previous key cannot be decrypted with the replacement.

## Rollback

- Application rollback: select the last verified Render deploy. Do not roll back application code across an incompatible schema boundary.
- Database rollback: restore to a Neon branch or point in time, verify it privately, then promote or change the connection only after reviewing data loss since the restore point.
- Secrets: rotate the affected credential in its provider and Render. Rotating `SESSION_SECRET` invalidates all sessions.
- Email: revoke the Resend key, issue a new least-privilege key, and verify delivery before re-enabling public actions.

## Monitoring and maintenance

- Alert on failed health checks, deploy failures, repeated 5xx responses, unusual 401/403/429 volume, database limits, and email delivery failures.
- Logs are structured JSON and include request ID, method, redacted path, status, duration, and Cloudflare Ray ID where available. Bodies, cookies, credentials, and tokens are not logged.
- Keep one API instance while rate limits use memory. Add a shared Redis-compatible rate-limit store before horizontal scaling.
- Remove expired sessions and auth tokens on a scheduled maintenance job after hosted behavior is established.
- Review dependency alerts weekly and repeat the security/browser workflow after cookie, proxy, CSP, authentication, or infrastructure changes.
