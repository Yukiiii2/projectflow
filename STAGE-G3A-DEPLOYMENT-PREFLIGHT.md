# ProjectFlow Stage G3A Free-Tier Deployment Compatibility Checkpoint

**Date:** 2026-10-26 (Asia/Taipei)

**Baseline:** `94eca22a1707b0d7c0dfbba2c5fd454b7aecfa3a` (`feat: complete Stage G2 recovery readiness`), synchronized with `origin/main` before this work

**Status:** The repository is locally ready for a controlled **US$0/month** Render Free + Neon Free + Resend Free deployment. Deployment remains blocked until these uncommitted changes are reviewed, committed and pushed, the hosted GitHub Actions run passes, and the provider-only checks below are completed.

No cloud service was created, no deployment or DNS change was made, no credential or production database was used, and no commit or push was performed.

## Outcome

The free-tier topology is now:

```text
Browser -> Render Free web service (Express /api + built Vite SPA)
                       |-> Neon pooled PostgreSQL URL (normal traffic)
                       |-> Resend HTTPS Email API

Trusted operator/CI -> Neon direct PostgreSQL URL (migrations only)
```

The existing same-origin Express/Vite design, PostgreSQL schema, authorization rules, secure sessions, transactional encrypted email outbox, and retry policy are preserved.

## Implemented compatibility changes

### Node.js 24 and GitHub Actions

- Root and backend package engines now require `>=24 <25`.
- The backend development types use `@types/node@24`.
- `render.yaml` selects Node 24.
- Every GitHub Actions job selects Node 24 and the fixed `ubuntu-24.04` runner.
- First-party actions use `actions/checkout@v7` and `actions/setup-node@v7`, whose current releases run on the Node 24 action runtime.
- The existing frontend checks, three-time-zone backend test matrix, backend checks, PostgreSQL migration serialization test, and isolated database recovery test remain in CI.

This addresses the prior hosted frontend failure: the old workflow ran the current frontend toolchain on Node 20, causing Vitest workers to fail before tests ran because the installed Undici version required a newer runtime. A new hosted run cannot be observed until these changes are committed and pushed.

### Neon pooled runtime and direct migrations

- Render's `DATABASE_URL` remains the Neon **pooled** TLS URL for application and session traffic.
- Production migration commands now require a separate `MIGRATION_DATABASE_URL`.
- `MIGRATION_DATABASE_URL` must be a PostgreSQL URL, include `sslmode=require` or stronger, and must not use Neon's `-pooler` hostname.
- Local development and CI continue to fall back to `DATABASE_URL`, so existing local and PostgreSQL service-container workflows are unchanged.
- Both `db:migrate` and `verify:migrations:postgres` use the same selection logic.

The separation is required because ProjectFlow's migration runner holds a session-level PostgreSQL advisory lock across migration transactions. Neon's pooled endpoint uses PgBouncer transaction pooling and is appropriate for request traffic, while the direct endpoint preserves the session state required by that lock.

Migrations are still never run automatically during application startup. A trusted operator must run them once, before the first deployment, from a protected local or CI environment.

### Resend HTTPS email delivery

Production now defaults to `INVITATION_DELIVERY=resend`. The transport:

- sends only to Resend's fixed `https://api.resend.com/emails` endpoint;
- uses a bearer `RESEND_API_KEY`, JSON content, an explicit user agent, and a ten-second timeout;
- requires a successful HTTP response containing a provider message ID;
- emits sanitized errors containing only the provider status or a generic request/response failure;
- never logs the API key, provider response body, email token, or token-bearing URL; and
- sends `projectflow/outbox/<message-id>` as the Resend idempotency key.

Invitation, email-verification, and password-reset content construction and token security are unchanged. The existing encrypted PostgreSQL outbox remains the source of delivery work. Row claiming, attempt counters, exponential retry schedule, terminal failure logging, and deletion only after confirmed delivery are preserved. The stable outbox-row idempotency key reduces duplicate delivery when the provider accepted a request but the response was lost.

The existing SMTP transport remains available for development or a future compatible host, but it is no longer selected by the Render Free Blueprint. Render Free blocks outbound SMTP ports 25, 465, and 587; HTTPS delivery avoids that restriction without adding an SDK dependency.

## Render Blueprint verification

| Setting | Verified value |
| --- | --- |
| Service type | One Node web service |
| Plan | `free` |
| Region | `singapore` |
| Auto deploy | Off |
| Build | `npm ci && npm --prefix backend ci && npm run build:all` |
| Start | `npm start` -> `node backend/dist/server.js` |
| Health check | `/api/health`, including a real database query |
| Runtime | Node 24 |
| Static SPA | Express serves the built root `dist`; deep routes fall back to `index.html` |
| API routing | `/api` remains JSON and is not swallowed by the SPA fallback |
| Port | Render-injected `PORT`; the server does not bind to localhost |
| Persistent disk | None; application data and sessions live in PostgreSQL |
| Email | Resend HTTPS API, not SMTP |

Render terminates public TLS before forwarding to the service, so the initial bounded proxy setting remains `TRUST_PROXY_HOPS=1`. Secure `__Host-` session cookies, HSTS, CSP, other Helmet headers, exact-origin CORS, and production environment validation remain enabled.

## Environment checklist

Never place real values in Git, chat, CI logs, screenshots, or this checkpoint.

### Render non-secret values

| Variable | Required value or rule |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | Exact assigned HTTPS Render origin; no wildcard, path, or trailing slash |
| `TRUST_PROXY_HOPS` | `1`, subject to hosted verification |
| `REQUIRE_EMAIL_VERIFICATION` | `true` |
| `INVITATION_DELIVERY` | `resend` |
| `INVITATION_FROM` | Verified Resend sender identity |
| `INVITATION_TTL_HOURS` | `168` |
| `VERIFICATION_TTL_MINUTES` | `1440` |
| `PASSWORD_RESET_TTL_MINUTES` | `60` |
| `LOG_LEVEL` | `info` initially |

### Render secrets

| Variable | Required value or rule |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** URL; hostname contains `-pooler`; approved TLS mode present |
| `SESSION_SECRET` | New independent random value accepted by the production validator |
| `RESEND_API_KEY` | Least-privilege sending key, domain-restricted if available |
| `EMAIL_OUTBOX_KEY` | Independent canonical base64 key of the documented size; back it up before mail is queued |

### Migration operator only

| Variable | Required value or rule |
| --- | --- |
| `NODE_ENV` | `production` |
| `MIGRATION_DATABASE_URL` | Neon **direct/unpooled** TLS URL with no `-pooler` hostname |

Run `npm --prefix backend run db:migrate` only from the protected operator environment. Clear the value or close the shell immediately afterward.

### Values intentionally absent from Render

- `PORT`: Render injects it.
- `VITE_API_URL`: same-origin browser requests are required.
- `MIGRATION_DATABASE_URL`: it is not needed by the web process.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`: the Free service uses HTTPS.
- `RECOVERY_ADMIN_DATABASE_URL`: recovery tooling must not be available to the web process.

## Local verification evidence

All checks below were run on Node.js 24 after clean lockfile installations:

| Check | Result |
| --- | --- |
| Root `npm ci` | Passed; 133 packages audited, 0 vulnerabilities |
| Backend `npm ci` | Passed; 208 packages audited, 0 vulnerabilities |
| Frontend tests | 8 files, **37/37 passed** |
| Backend tests | 10 files, **65/65 passed** |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed; 1,948 modules transformed |
| Backend production build | Passed |
| Frontend dependency audit | 0 vulnerabilities |
| Backend dependency audit | 0 vulnerabilities |
| Diff whitespace check | Passed |

Focused coverage added in this change verifies:

- Resend endpoint, authorization, payload, user agent, and stable idempotency header;
- sanitized handling of rate-limit/API failure, network failure, malformed success response, and missing API configuration;
- outbox propagation of the stable idempotency key without changing encryption or retry behavior;
- production acceptance of Resend configuration and rejection of missing/placeholder keys;
- selection of the direct production migration URL instead of the pooled runtime URL;
- rejection of missing, pooled, or insufficiently protected production migration URLs; and
- local/CI fallback to `DATABASE_URL`.

The backend clean install emits npm's allow-scripts review notice for the already-approved native dependencies `argon2` and `esbuild`. Their versions did not change in this work, and the backend tests, typecheck, and build execute successfully after the clean install. This notice is not a vulnerability finding.

The workflow and Render Blueprint were manually reviewed for structure and current action/provider settings. The installed machine has no YAML linter, and no lint-only dependency was added. GitHub remains the authoritative workflow parser; its hosted result is a required gate after push.

## Free-tier constraints and residual risks

- Render Free sleeps after 15 minutes without inbound traffic and can take roughly a minute to wake. It has no shell or one-off jobs, so migrations must run elsewhere.
- A sleeping Render process cannot advance timed outbox retries. A message queued during an inbound request receives immediate processing, but repeated transient failures may remain pending until later inbound traffic wakes the service.
- Resend retains idempotency keys for 24 hours. A retry delayed beyond that period after an ambiguous provider response can still duplicate mail; operational review of prolonged failures is required.
- Render Free has an ephemeral filesystem. ProjectFlow does not rely on it for durable state.
- Neon Free can scale to zero, adding first-query latency. Runtime traffic must use the pooled URL; migrations, backups, restores, and other session-sensitive tools must use a direct URL.
- Free-tier quotas and pricing can change. Recheck each provider immediately before provisioning.
- The current rate limiter is process-local. Keep one Render instance; this is compatible with Render Free's single-instance model.
- The free configuration is suitable for a controlled portfolio launch, not an uptime or recovery SLA.

## Hosted-only blockers

The following cannot be proven locally and remain mandatory before public use:

1. Review, commit, and push these changes without force.
2. Require the entire GitHub Actions workflow to pass on the pushed `main` commit.
3. Secure Render, Neon, and Resend accounts with MFA and stored recovery codes.
4. Create the Neon Free project, select the nearest practical region, and store its pooled and direct TLS URLs separately.
5. Create a Neon restore point/branch, run migrations through `MIGRATION_DATABASE_URL`, inspect the five migration ledger rows, then rerun and require zero new applications.
6. Verify a sending domain in Resend using the exact provider-issued DNS records; create a restricted sending key.
7. Preview and create the Render Free service from `render.yaml`, then enter secrets only in Render's secret controls.
8. Verify external health, cold start, SPA deep routing, API JSON 404 behavior, managed TLS, headers, real client IP, and secure session cookies.
9. Test registration, one-time email verification, login/logout, password reset/session invalidation, workspace/project/task/Kanban operations, and a second-account invitation.
10. Confirm delivery at two mailbox providers and observe bounce, complaint, suppression, retry, and terminal-failure behavior without token leakage.
11. Configure external monitoring and provider alerts, and complete an encrypted hosted backup plus isolated restore rehearsal before meaningful user data accumulates.

## Guided first-deployment sequence

### Repository gate

- [ ] Review this diff and checkpoint.
- [ ] Commit and push only after approval.
- [ ] Confirm a fully green `main` workflow.
- [ ] Confirm the target SHA and that no secret or `.env` file is tracked.

### Provider preparation

- [ ] Create or secure Render, Neon, and Resend accounts with MFA.
- [ ] Recheck free-plan quotas and set available usage alerts/spend controls.
- [ ] Create Neon Free; save pooled and direct URLs separately in a password manager.
- [ ] Create a Neon pre-migration recovery point or branch.
- [ ] Run and replay migrations from a protected operator shell using the direct URL.
- [ ] Add and verify the Resend sending domain; create the least-privilege key.

### Render configuration

- [ ] Connect Render to the repository with the least practical scope.
- [ ] Preview `render.yaml`; reject unexpected resources or paid-plan substitutions.
- [ ] Keep auto-deploy off and select the intended green commit.
- [ ] Set the exact assigned Render URL as `FRONTEND_ORIGIN`.
- [ ] Enter only the documented runtime values; use the pooled Neon URL.
- [ ] Confirm migration, SMTP, recovery-admin, `VITE_API_URL`, and manual `PORT` values are absent.

### Controlled deployment and acceptance

- [ ] Start one manual deployment and inspect sanitized build/start logs.
- [ ] Run the hosted health, static routing, TLS/header, proxy, and cookie checks.
- [ ] Exercise all critical authentication and collaboration workflows with controlled accounts.
- [ ] Verify live Resend delivery, outbox state, idempotent retry behavior, bounces, and alerts.
- [ ] Keep the URL unadvertised until monitoring and hosted recovery gates pass.

## Readiness decision

| Area | Status |
| --- | --- |
| Node 24 alignment | Locally verified |
| CI configuration | Locally reviewed; hosted run required after push |
| Render Free configuration | Locally verified; provider preview and smoke test required |
| Neon pooled runtime | Implemented/configured; hosted connection required |
| Neon direct migrations | Implemented and unit-tested; hosted execution required |
| Resend HTTPS transport | Implemented and tested with mocked responses; live sender/delivery required |
| Encrypted outbox/retries | Preserved and regression-tested |
| Typechecks/builds/tests/audits | Passed locally |
| Monitoring and recovery | Documented; hosted setup and rehearsal required |
| Public launch | Blocked pending every hosted-only gate |

## Provider references checked

- [Render Free limitations](https://render.com/docs/free): free-plan sleep behavior, ephemeral storage, missing shell/one-off jobs, and blocked SMTP ports.
- [Render web services](https://render.com/docs/web-services): public HTTPS, port binding, and managed service behavior.
- [GitHub `setup-node`](https://github.com/actions/setup-node/blob/main/README.md) and [`checkout`](https://github.com/actions/checkout): current Node 24-compatible action majors and Node 24 workflow examples.
- [Neon connection pooling](https://neon.com/blog/postgres-support-case-recap): pooled endpoint naming and PgBouncer behavior.
- [PgBouncer feature compatibility](https://www.pgbouncer.org/features.html): transaction-pooling limitations for session advisory locks.
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency keys](https://resend.com/changelog/idempotency-keys): HTTPS request contract and 24-hour idempotency window.

Stage G3A compatibility work stops here for review. No deployment, account creation, paid resource, DNS modification, production credential, database mutation, commit, or push was performed.
