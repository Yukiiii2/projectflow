# ProjectFlow backend foundation

This folder contains the API used by the local full-stack prototype for authentication, workspaces, projects, tasks, Kanban workflows, and team collaboration. The API uses Express, TypeScript, PostgreSQL through `node-postgres`, raw SQL migrations, Argon2id password hashes, and PostgreSQL-backed sessions. There is no Prisma dependency or Prisma schema.

## Local Windows setup

PostgreSQL must be installed and running. In PowerShell, open `psql` with the administrator role created by the PostgreSQL installer:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d postgres
```

If a different PostgreSQL version is installed, replace `18` in the path. Enter the administrator password when prompted, then create a dedicated local role and database:

```sql
CREATE ROLE projectflow LOGIN PASSWORD 'choose-a-unique-local-password';
CREATE DATABASE projectflow OWNER projectflow;
\q
```

If the role already exists, reset its password with `ALTER ROLE projectflow WITH LOGIN PASSWORD 'choose-a-unique-local-password';`. Do not repeat `CREATE DATABASE` if the database already exists.

From `prototype/backend`:

```powershell
npm.cmd install
Copy-Item .env.example .env
notepad .env
```

Replace `CHANGE_ME` in `DATABASE_URL` with the role password. Percent-encode reserved URL characters in the password. Replace `SESSION_SECRET` with a cryptographically random value of at least 32 characters. This PowerShell snippet produces one:

```powershell
$secretBytes = New-Object byte[] 48
$randomSource = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomSource.GetBytes($secretBytes)
$randomSource.Dispose()
[Convert]::ToBase64String($secretBytes)
```

Keep `.env` local; it is ignored by the repository configuration. Then install the schema and start the API:

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

The migration command checks every numbered SQL migration in order. It uses a session advisory lock, one transaction per pending file, and a checksum ledger so repeat runs skip applied files and changed migration history is rejected. Local and CI runs fall back to `DATABASE_URL`; production requires an operator-only `MIGRATION_DATABASE_URL` using Neon's direct, non-pooler TLS endpoint. The normal application continues using the pooled `DATABASE_URL`. Migration `003_account_security.sql` adds verified-email state, session versions, and hashed authentication tokens without deleting existing data. Migration `004_runtime_operations.sql` tracks the session table, enforces one outstanding token per user/purpose, and creates the production email outbox so the runtime role does not need schema privileges.

Local invitation delivery defaults to a preview link:

```dotenv
INVITATION_TTL_HOURS=168
INVITATION_DELIVERY=preview
```

Preview mode does not send an email. For Render Free, set `INVITATION_DELIVERY=resend`, provide a sending-only `RESEND_API_KEY`, and use a verified custom-domain `INVITATION_FROM`. Resend's `@resend.dev` testing sender is rejected in production because it cannot deliver public registration email to arbitrary recipients. Delivery uses Resend's fixed HTTPS endpoint, a ten-second timeout, required authorization and user-agent headers, and a stable outbox-row idempotency key. Optional SMTP compatibility remains available on hosts that permit outbound SMTP by setting `INVITATION_DELIVERY=smtp` and the documented `SMTP_*` values. Production rejects preview delivery. Production requests atomically place invitation, verification, and reset messages in a PostgreSQL outbox with their source records. AES-256-GCM protects queued payloads using `EMAIL_OUTBOX_KEY`; the worker applies bounded retries and deletes successful, expired, or five-times-failed rows. Rejection logs and retry metadata retain only the provider status, machine-readable error code, and a secret-safe reason category; raw provider text, recipients, and bearer URLs are never recorded. Authentication token tables store only SHA-256 hashes.

For domain-independent local verification, first build the SPA and then run `npm run verify:email:browser` from this directory. The command refuses remote database hosts, creates and later drops a random schema on local PostgreSQL, and routes the real encrypted outbox into an in-process test capture. The capture transport is not selectable through environment variables, is excluded from production compilation, and never returns bearer URLs over HTTP. See `EMAIL-TESTING-CHECKPOINT.md` in the repository root for coverage and cleanup details.

The API defaults to `http://localhost:4000`. Confirm database-backed health from another PowerShell window:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

The server checks PostgreSQL before listening, so invalid credentials or an unavailable database stop startup instead of reporting a misleading ready state.

## Checks

```powershell
npm.cmd test
npm.cmd run verify:migrations:postgres
npm.cmd run verify:recovery:postgres
npm.cmd run verify:auth:live
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit --omit=dev
```

The integration tests use an isolated in-memory PostgreSQL-compatible database and a memory session store. They cover authentication, Argon2id storage, session cookies, authentication throttling, origin checks, 64 KB JSON limits, safe parser errors, production configuration, workspace isolation, project/task permissions, invitation lifecycle and email matching, role boundaries, comment ownership and moderation, member-removal assignment cleanup, activity isolation, token concurrency, outbox delivery, and migration cleanup. `verify:migrations:postgres` exercises concurrent migration runners against PostgreSQL. `verify:recovery:postgres` uses `pg_dump` and `pg_restore`, creates only a strictly named `projectflow_recovery_verify_<random hex>` database, compares the migration ledger and critical row counts, proves a failing migration rolls back, performs a transactional read/write smoke test, and drops the disposable database in cleanup. The source role must have `CREATEDB`, or `RECOVERY_ADMIN_DATABASE_URL` must temporarily provide a separate administrative connection that can create and drop a database owned by the source role. Never put that administrative URL in `.env`, CI logs, or repository files. On Windows, set `POSTGRES_BIN_DIR` for the command if PostgreSQL's `bin` directory is not on `PATH`.

`verify:auth:live` and `verify:readiness:live` use unique temporary records and clean them up. The frontend browser QA scripts exercise complete workflows with temporary records and clean them up afterward.

## Browser behavior

Write requests must carry the exact `Origin` configured by `FRONTEND_ORIGIN`, which defaults to `http://localhost:5173`. Cross-site Fetch Metadata is rejected. Browser requests use `credentials: 'include'`. Production requires an HTTPS origin, a TLS PostgreSQL URL, configured Resend API or SMTP delivery, email verification, a non-placeholder session secret, a known proxy-hop count, and a Secure/HttpOnly/SameSite=Lax `__Host-projectflow.sid` cookie. Failed logins are limited to 10 per 15 minutes per client IP; registrations are limited to 20 per hour; recovery routes are limited to 10 per 15 minutes. Replace the in-memory limiter store before horizontal scaling.

## Current API

- `GET /api/health`
- `POST /api/auth/register` with `{name,email,password}`; passwords must contain 12–128 characters
- `POST /api/auth/login` with `{email,password}`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/email-verification/request`
- `POST /api/auth/email-verification/confirm` with `{token}`
- `POST /api/auth/password-reset/request` with `{email}`; always returns the same accepted response
- `POST /api/auth/password-reset/confirm` with `{token,password}`
- `GET /api/workspaces`
- `POST /api/workspaces` with `{name}`
- `GET /api/workspaces/:wid/projects`
- `GET /api/workspaces/:wid/tasks`
- `GET /api/workspaces/:wid/members`
- `POST /api/workspaces/:wid/projects` with `{name,description}` for owners and admins
- `PATCH /api/workspaces/:wid/members/:uid` with `{role}` according to owner/admin policy
- `DELETE /api/workspaces/:wid/members/:uid` according to owner/admin policy
- `GET /api/workspaces/:wid/invitations` for owners and admins
- `POST /api/workspaces/:wid/invitations` with `{email,role}`
- `DELETE /api/workspaces/:wid/invitations/:iid`
- `GET /api/invitations/:token`
- `POST /api/invitations/:token/accept` for a signed-in user with the invited email
- `GET /api/projects/:pid`
- `PATCH /api/projects/:pid`
- `GET /api/projects/:pid/tasks`
- `POST /api/projects/:pid/tasks` with `{title,description?,status?,priority?,dueDate?,assigneeId?}`
- `PATCH /api/tasks/:tid` with partial task fields
- `GET /api/tasks/:tid/comments`
- `POST /api/tasks/:tid/comments` with `{body}`
- `PATCH /api/comments/:cid` with `{body}` for the author
- `DELETE /api/comments/:cid` for the author or a workspace owner/admin
- `GET /api/tasks/:tid/activity`

Workspace access is enforced server-side using membership joins, and inaccessible cross-workspace resources return 404. Owners may manage admins and members; admins may invite, revoke, and remove members; owners cannot be reassigned or removed. Ownership transfer, distributed throttling, hosted backup/restore rehearsal, live provider verification, hosted proxy/TLS validation, and an external security review remain required before a public launch.
