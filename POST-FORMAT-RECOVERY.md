# ProjectFlow Post-Format Recovery

This checkpoint is intended to restore the ProjectFlow development environment after reinstalling Windows. The canonical repository is `https://github.com/Yukiiii2/projectflow.git` on branch `main`.

## Clone the repository

```powershell
Set-Location "$HOME\Documents"
git clone https://github.com/Yukiiii2/projectflow.git
Set-Location projectflow
git switch main
git status
```

## Required software

- Git for Windows.
- Node.js 20 or newer. Node.js 20 LTS is the CI baseline.
- npm, bundled with Node.js.
- PostgreSQL. The current Windows documentation uses PostgreSQL 18; another supported local version is acceptable if the executable path is adjusted.

Confirm the toolchain:

```powershell
git --version
node --version
npm.cmd --version
```

## Install dependencies

From the repository root:

```powershell
npm.cmd ci
npm.cmd --prefix backend ci
```

`node_modules`, compiled `dist` directories, coverage, build caches, and TypeScript build-info files are intentionally excluded from Git and must be regenerated.

## Install and configure PostgreSQL

Install PostgreSQL, keep the database service running, and open `psql` with the administrator role created by the installer. Adjust `18` if a different version is installed:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d postgres
```

Create a dedicated local role and database. Replace the placeholder with a new local-only password and do not commit it:

```sql
CREATE ROLE projectflow LOGIN PASSWORD 'CHOOSE_A_NEW_LOCAL_PASSWORD';
CREATE DATABASE projectflow OWNER projectflow;
\q
```

If the role already exists, use `ALTER ROLE projectflow WITH LOGIN PASSWORD 'CHOOSE_A_NEW_LOCAL_PASSWORD';`. Do not recreate an existing database.

## Restore or create environment files

Create local files from the safe templates:

```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
```

Both real `.env` files are ignored. Restore `backend\.env` only from a secure offline backup, or create new secrets after reinstalling Windows. Never copy real values into `.env.example`.

Frontend variable:

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Local API base URL. Use `http://localhost:4000` for local development; omit it for the planned same-origin production build. |

Backend variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Local example: `postgresql://projectflow:CHOOSE_A_NEW_LOCAL_PASSWORD@localhost:5432/projectflow`. Percent-encode reserved password characters. Production requires a pooled TLS URL with `sslmode=require` or stronger. |
| `SESSION_SECRET` | Independent cryptographically random session-signing secret of at least 32 characters. |
| `FRONTEND_ORIGIN` | Exact browser origin; locally `http://localhost:5173`. |
| `PORT` | API port; locally defaults to `4000`. Let a hosting platform provide it in production. |
| `INVITATION_TTL_HOURS` | Invitation lifetime; the template default is `168`. |
| `VERIFICATION_TTL_MINUTES` | Email-verification token lifetime; the template default is `1440`. |
| `PASSWORD_RESET_TTL_MINUTES` | Password-reset token lifetime; the template default is `60`. |
| `REQUIRE_EMAIL_VERIFICATION` | Whether unverified accounts are blocked from protected application routes. |
| `TRUST_PROXY_HOPS` | Known reverse-proxy hop count; must be verified in a hosted environment. |
| `LOG_LEVEL` | Structured log threshold. |
| `INVITATION_DELIVERY` | `preview` for local development or `smtp` for an approved hosted environment. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | SMTP provider connection settings. `SMTP_PASSWORD` is a secret. |
| `INVITATION_FROM` | Verified sender identity used for invitations and account lifecycle email. |
| `EMAIL_OUTBOX_KEY` | Independent canonical Base64 encoding of exactly 32 random bytes for AES-256-GCM queued-email payloads. Required for production outbox processing. |
| `NODE_ENV` | Use `development` locally and `production` only with all production requirements satisfied. |

Generate a new `SESSION_SECRET` locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
```

Generate a separate `EMAIL_OUTBOX_KEY` when needed:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Paste each value only into the local ignored `backend\.env` or an approved hosting secret store. Never reuse either value as a database or SMTP password.

## Configure `DATABASE_URL` and run migrations

For a normal local installation, set this shape in `backend\.env` with the new password:

```dotenv
DATABASE_URL=postgresql://projectflow:CHOOSE_A_NEW_LOCAL_PASSWORD@localhost:5432/projectflow
```

Apply the ordered migrations from the backend directory:

```powershell
Set-Location backend
npm.cmd run db:migrate
Set-Location ..
```

The runner acquires a PostgreSQL advisory lock, applies each pending numbered file in its own transaction, and records checksums in `schema_migrations`. Never edit an applied migration file. If restoring a database dump, restore it first and then run `db:migrate` to apply only later migrations.

## Run the application locally

Backend terminal:

```powershell
Set-Location backend
npm.cmd run dev
```

Frontend terminal from the repository root:

```powershell
npm.cmd run dev -- --host localhost --port 5173
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:4000/api/health`.

## Tests, type checks, audits, and builds

Frontend and combined build checks from the repository root:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit --audit-level=high
npm.cmd run build:all
```

Backend checks:

```powershell
Set-Location backend
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high
```

With a disposable or backed-up real PostgreSQL database configured, optional live checks are:

```powershell
npm.cmd run verify:migrations:postgres
npm.cmd run verify:auth:live
npm.cmd run verify:readiness:live
```

The browser QA commands documented in the root README require PostgreSQL, the API, and the frontend to be running. They create isolated temporary records and are intended to clean them up.

## Resume Stage G2 safely

Start by reading, in order:

1. `STAGE-G1-DEPLOYMENT-PLAN.md`
2. `STAGE-G2-READINESS-CHECKPOINT.md`
3. `docs/DEPLOYMENT-RUNBOOK.md`
4. `docs/DATABASE-RECOVERY.md`

Stage G2 local implementation is complete. Resume at the hosted-verification gates in `STAGE-G2-READINESS-CHECKPOINT.md`; do not redo Stages A–F and do not provision or deploy until explicit approval is given. The next work is provider configuration and controlled verification for Render, Neon, and Resend, not new feature development.

## Current incomplete features and deployment blockers

- No Render, Neon, or Resend resources or credentials have been created or tested.
- Live SMTP delivery, sender DNS, bounce handling, and provider quotas are unverified.
- Render proxy hops, HTTPS redirects, secure cookies, CSP/HSTS delivery, Neon TLS, and same-origin routing require public-origin verification.
- The committed GitHub Actions workflow must run successfully on GitHub after this checkpoint is pushed.
- Rate limiting is process-local and supports only the planned single-instance portfolio service; horizontal scaling requires a shared store.
- Automated logical database exports and a hosted restore rehearsal are not configured.
- Monitoring provider, alert recipients, retention, and privacy settings remain undecided.
- External penetration, load, denial-of-service, and incident-response testing have not been performed.
- Workspace ownership transfer remains outside the implemented scope.
- The application is not approved for unrestricted public registration or production-readiness claims.

## Files GitHub cannot restore

Before formatting, separately back up the following to encrypted removable storage or another trusted location:

- `C:\Users\EN\Documents\ProjectFlow-Design\prototype\backend\.env` contains local credentials and must be stored only in a secure backup, or recreated with new values.
- `C:\Users\EN\Documents\ProjectFlow-Design\prototype\artifacts\` contains QA reports and screenshots.
- `C:\Users\EN\Documents\ProjectFlow-Design\prototype\.superpowers\` and `C:\Users\EN\Documents\ProjectFlow-Design\prototype\docs\superpowers\` contain local planning/progress records ignored by Git.
- The files beside the repository in `C:\Users\EN\Documents\ProjectFlow-Design\`: `Brief-1.png`, `Brief-2.png`, `Brief-3.png`, `Concept-A.png`, `Concept-B.png`, `Concept-C.png`, `Design-checkpoint.md`, `design-state.json`, `Draft-components.png`, `Draft-foundations.png`, `Phase2A-Recovery.md`, `Phase2B-Figma-Resume.md`, `Phase2B-MVP-Plan.md`, `Phase2B-Screen-Checklist.md`, `projectflow-foundations-phase2a.png`, and `prototype.zip`.
- Any Figma files stored only locally or in an account that will not be available after reinstall. Git does not contain native Figma cloud documents.
- The local PostgreSQL database. No dump file was found in the repository. Create a logical dump before formatting if its data matters.

Example custom-format PostgreSQL dump to an external drive or other backup location:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h localhost -p 5432 -U projectflow -d projectflow -Fc -f 'E:\ProjectFlow-Backup\projectflow-postgres.dump'
```

Restore that dump after creating the role and an empty database:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' -h localhost -p 5432 -U projectflow -d projectflow 'E:\ProjectFlow-Backup\projectflow-postgres.dump'
```

Restore into a new, empty database. A dump can contain private user data and must never be committed to Git.
