# ProjectFlow Stage G3C deployment checkpoint

Date: 2026-10-27

Target: first controlled deployment on one Render Free web service, Neon Free PostgreSQL, and Resend Free HTTPS API

Status: local readiness verified; the first external Render deployment later failed before startup and is covered by the repair addendum below

## Outcome

ProjectFlow is locally ready for the external-account portion of the first Render Free deployment. The application remains one Express process serving `/api` and the compiled Vite SPA from the same origin. Runtime traffic uses the limited pooled Neon role, migrations use the protected direct migration connection, and all transactional email uses Resend's HTTPS API through the encrypted PostgreSQL outbox.

At the time of the original checkpoint, no Render service, Resend resource, DNS record, paid feature, database reset, production migration, or live deployment had been created. The user later created the Render Free service and attempted the failed deployment described in the repair addendum; this repository repair does not create or modify provider resources.

## G3B database finalization

The final redacted privilege check confirmed that `projectflow_runtime`:

- authenticates only through the pooled TLS runtime URL and is distinct from the direct migration role;
- is not superuser, database creator, role creator, replication-enabled, RLS-bypassing, or a member of `neon_superuser`;
- owns no database objects, cannot create persistent objects in `public`, and cannot read or modify `schema_migrations`;
- has schema `USAGE` and exact `SELECT`, `INSERT`, `UPDATE`, and `DELETE` rights on the eleven runtime tables; and
- can perform application/session/outbox operations while migration DDL and the session advisory lock remain restricted to the direct migration connection.

The inherited `PUBLIC TEMPORARY` grant is PostgreSQL's database default. Privileges are additive, so it cannot be denied only for the runtime role while `PUBLIC` retains it. A change would be database-wide and would affect every role. ProjectFlow does not rely on temporary objects and the limited role cannot create persistent objects in the application schema; no additional change is necessary for this release.

Fresh migration replay reported **0 applied, 5 already current**, and the concurrent-runner serialization check passed. No existing record, role, grant, schema object, or migration was altered by the final recheck.

## Demonstrated defect and focused fix

The first production artifact scan found two release-only defects:

1. a developer's ignored root `.env` could cause `VITE_API_URL=http://localhost:4000` to be compiled into a production build; and
2. CSS for the development preview-state control was included in production assets even though the control itself is development-only.

Production API requests now always use same-origin relative paths. The localhost override is evaluated only in Vite development mode. Preview-control CSS moved to a development-only dynamic import. A repository script now scans built HTML, JavaScript, and CSS for localhost API URLs, preview controls, and credential markers. `build:all`, GitHub Actions, and the Render build path run that gate.

No UI layout, application feature, API schema, authorization rule, or database schema changed.

## Render Free configuration verified

The committed [Render Blueprint](./render.yaml) proposes exactly one service:

| Setting | Required value |
| --- | --- |
| Type/runtime/plan | Web / Node / Free |
| Region | Singapore |
| Automatic deploys | After required GitHub checks pass (`checksPass`) |
| Node | `NODE_VERSION=24` with package engines `>=24 <25` |
| Build command | `npm ci && npm --prefix backend ci && npm run build:all` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Port | Provider-supplied `PORT`; do not override |
| Instances/disks/add-ons | One Free instance; none |

The production smoke test used the compiled server and real limited Neon runtime connection. It verified:

- `GET /api/health` returns HTTP 200 with database connectivity;
- CSP, HSTS, frame denial, MIME-sniff prevention, and structured request logs;
- SPA deep-link fallback and `no-cache` HTML;
- immutable hashed static assets and JSON-only `/api` 404 responses;
- HTTP-to-HTTPS redirect behavior, rejection of insecure state-changing requests, and the configured proxy hop;
- platform-style `PORT` binding and same-origin `/api` routing; and
- graceful handling of the shutdown signal and database-pool closure.

Production sessions remain PostgreSQL-backed. Cookies use `__Host-projectflow.sid`, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` without `Domain`. Resend delivery uses outbound HTTPS, not SMTP.

## Exact Render environment checklist

Enter secret values only in Render's protected environment UI. Never paste them into source control, Blueprint YAML, GitHub Actions, chat, screenshots, or logs.

### Secrets requiring manual entry

- `DATABASE_URL` — pooled Neon TLS URL using `projectflow_runtime`.
- `SESSION_SECRET` — independent random value of at least 32 characters.
- `FRONTEND_ORIGIN` — exact final `https://<service-host>` origin, with no path or trailing slash.
- `RESEND_API_KEY` — sending-only key for the verified production domain where available.
- `EMAIL_OUTBOX_KEY` — canonical Base64 encoding of exactly 32 random bytes; independent from the session secret.
- `INVITATION_FROM` — sender on the verified Resend domain, for example `ProjectFlow <invites@your-domain>`.

### Blueprint non-secret values to confirm

- `NODE_VERSION=24`
- `NODE_ENV=production`
- `TRUST_PROXY_HOPS=1`
- `REQUIRE_EMAIL_VERIFICATION=true`
- `INVITATION_TTL_HOURS=168`
- `VERIFICATION_TTL_MINUTES=1440`
- `PASSWORD_RESET_TTL_MINUTES=60`
- `INVITATION_DELIVERY=resend`
- `LOG_LEVEL=info`

### Variables that must be absent from the web service

- `MIGRATION_DATABASE_URL`
- `RECOVERY_ADMIN_DATABASE_URL`
- `VITE_API_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`
- any local `.env` value or administrator/owner database URL

The direct `MIGRATION_DATABASE_URL` stays only in the protected operator environment for the deliberate migration step. It is not a runtime secret and is not used by Render startup.

## Local verification evidence

| Verification | Result |
| --- | --- |
| Frontend Vitest | 8 files, 37 tests passed |
| Backend Vitest | 10 files, 65 tests passed |
| Focused auth/migration/production tests | 4 files, 26 tests passed |
| Frontend and backend TypeScript | Passed |
| Vite and Express production builds | Passed on Node 24.20.0 |
| Production artifact scanner | Passed |
| Root and backend dependency audits | 0 vulnerabilities |
| Neon migration replay | 0 applied, 5 current; concurrency passed |
| Live auth/readiness workflow | Passed; temporary records removed |
| Production server smoke | Passed |

The focused Playwright workflow ran against the real PostgreSQL database and covered registration, session creation, workspace onboarding, project/task creation, Kanban persistence, invitation acceptance, membership and role change, assignment, comments, activity, cross-workspace nondisclosure, origin enforcement, request limits, security headers, logout, sign-in, and session restoration. It captured desktop (1440×1000), tablet (768×900), mobile (390×844), and narrow mobile (320×720) views. Every view reported zero horizontal overflow, no out-of-bounds elements, and no automated accessibility violations. Desktop and mobile captures were also visually inspected. The workflow reported zero temporary accounts after cleanup, and a separate database query reconfirmed zero Stage F/G3C QA users.

Generated screenshots/reports, compiled output, local environments, and database credentials remain ignored and are not part of the commit.

## $0/month safeguards and current limits

- Render: keep the Blueprint at `plan: free`, one instance, no persistent disk, no Render database, no paid add-on, and automatic deploys gated on successful GitHub checks. Free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake; the workspace receives a monthly Free instance-hour allotment. Review usage and any spend controls before applying the Blueprint ([Render Free](https://render.com/docs/free)).
- Neon: keep the existing project on the Free plan, preserve the recovery branch/point, and review Free compute, storage, history, and branch usage in the account before launch ([Neon pricing](https://neon.com/pricing)).
- Resend: keep the account on Free. The published Free allowance is 3,000 emails/month and 100/day; do not enable a paid plan or pay-as-you-go ([Resend pricing](https://resend.com/pricing)).

Base hosting cost is therefore **$0/month while usage remains within all three providers' Free allowances**. Stop if any provider proposes an automatic upgrade, billable add-on, paid instance, or payment-dependent overage that has not been separately approved.

## First deployment — manual actions required

These actions cross the external-account boundary and were intentionally not performed:

1. **Account safety:** sign in to Render and Resend, enable MFA, confirm Neon remains Free, and review provider usage/spend alerts. Do not accept a paid workspace, instance, database, disk, support plan, or automatic upgrade.
2. **Resend domain:** add and verify a sending domain. Publish only the exact DNS records Resend supplies. Create a sending-only production API key and keep it private. Confirm the chosen `INVITATION_FROM` uses the verified domain.
3. **Neon release point:** confirm the production branch, database, pooled limited-role URL, direct migration-role URL, and recovery branch/point. Prefer `sslmode=verify-full` when Neon supplies/supports it. Do not change the existing runtime/migration role separation.
4. **Render Blueprint preview:** connect `Yukiiii2/projectflow`, select `main`, and import `render.yaml`. Before applying, confirm one Singapore **Free** web service, no disk/database/add-on, automatic deploys gated on successful checks, the exact commands and `/api/health`, and Node 24.
5. **Render secrets:** enter only the six required values listed above. Confirm the forbidden variables are absent. Render supplies `PORT`.
6. **Protected migration:** from the trusted local operator environment, set the direct `MIGRATION_DATABASE_URL`, create/confirm the recovery point, run `npm --prefix backend run db:migrate`, and run it again to confirm all five migrations are current. Do not run migrations from Render or through the pooled runtime URL.
7. **Manual deploy:** deploy the exact reviewed `main` commit only after its GitHub Actions workflow is green.
8. **Hosted acceptance:** verify HTTPS `/api/health`, headers and cookie flags, cold wake-up, registration, email verification, password reset, invitations, workspace/project/task/Kanban/comment flows, logout/sign-in, cross-workspace 404 behavior, encrypted outbox drain/retry, and no token/recipient leakage in logs.
9. **Monitoring:** configure a free external HTTPS check for `/api/health`, Render deploy/health notifications, Neon capacity alerts, Resend bounce/complaint visibility, and named primary/fallback responders. Do not purchase a monitoring add-on in this stage.
10. **Cleanup and go/no-go:** remove only hosted synthetic records, confirm no temporary accounts/outbox messages remain, record evidence, and keep public launch disabled until all hosted-only checks pass.

## Rollback procedure

1. Pause new registrations and releases if a significant hosted check fails.
2. For an application-only failure, use Render to redeploy the last verified commit. Never roll application code backward across an incompatible schema boundary.
3. For a database failure, stop writes, create/preserve a recovery point, restore to a separate Neon branch, verify it privately, quantify data loss, and only then switch the connection under explicit approval. Never reset the active database.
4. For email failure or suspected key exposure, stop delivery, revoke/rotate the Resend key, verify the sender and a synthetic delivery, then resume. Drain or deliberately purge the encrypted outbox before rotating `EMAIL_OUTBOX_KEY` because old queued payloads cannot be decrypted with a new key.
5. Rotate any affected Render secret; remember that rotating `SESSION_SECRET` invalidates every session.

## Remaining hosted-only risks and blockers

- Render cold starts, service quotas, real proxy/IP attribution, health behavior during deploy, and graceful shutdown under the platform must be observed live.
- Resend domain DNS, real verification/reset/invitation receipt, suppression/bounce/complaint handling, and key rotation are unverified.
- Neon Free retention, provider recovery behavior, connection limits, and a hosted branch restore still require account-side verification.
- The installed PostgreSQL client currently treats `sslmode=require` as host-verifying TLS, but `pg` 9 / `pg-connection-string` 3 plan libpq-compatible semantics. Re-evaluate and prefer `verify-full` before that upgrade.
- In-memory rate limiting supports the single Free instance only; horizontal scaling requires a shared limiter store.
- External uptime/error alert routing and the full public-origin workflow remain launch gates.

GitHub synchronization and the resulting CI run are reported separately because a checkpoint cannot contain the hash of the commit that contains itself. No deployment is authorized by this document.

## First Render deployment repair addendum — 2026-10-27

The first external deployment reached the start command but failed with `MODULE_NOT_FOUND` for `backend/dist/server.js`. A clean reproduction proved that the former root `npm run build` compiled only the Vite frontend: `dist/index.html` existed while the compiled Express entry point did not. The former Blueprint command also used plain `npm ci`, which omits build-time development dependencies when `NODE_ENV=production`.

The repair makes the root production build compile both applications, explicitly installs build dependencies during the Render build, prunes them afterward, and fails the build if either `dist/index.html` or `backend/dist/server.js` is missing or the start command points elsewhere. GitHub Actions now exercises this exact full-stack production build with `NODE_ENV=production`. No application feature, database configuration, authentication control, secret, or UI design changed.
