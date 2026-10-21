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

The migration command runs every numbered SQL migration in order. Migration `002_collaboration.sql` adds invitation lifecycle records, task activity records, comment edit timestamps, and membership join timestamps without deleting existing data.

Local invitation delivery defaults to a preview link:

```dotenv
INVITATION_TTL_HOURS=168
INVITATION_DELIVERY=preview
```

Preview mode does not send an email. To test real delivery, set `INVITATION_DELIVERY=smtp` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `INVITATION_FROM`. Production mode rejects preview delivery. Invitation tokens are delivered to recipients while PostgreSQL stores only their SHA-256 hashes.

The API defaults to `http://localhost:4000`. Confirm database-backed health from another PowerShell window:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

The server checks PostgreSQL before listening, so invalid credentials or an unavailable database stop startup instead of reporting a misleading ready state.

## Checks

```powershell
npm.cmd test
npm.cmd run verify:auth:live
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit --omit=dev
```

The integration tests use an isolated in-memory PostgreSQL-compatible database and a memory session store. They cover authentication, Argon2id storage, session cookies, authentication throttling, origin checks, 64 KB JSON limits, safe parser errors, production configuration, workspace isolation, project/task permissions, invitation lifecycle and email matching, role boundaries, comment ownership and moderation, member-removal assignment cleanup, and activity isolation. `verify:auth:live` exercises authentication against the running API and configured local PostgreSQL database, then removes its unique test account and session rows. The frontend browser QA scripts exercise complete workflows with temporary records and clean them up afterward.

## Browser behavior

Write requests must carry the exact `Origin` configured by `FRONTEND_ORIGIN`, which defaults to `http://localhost:5173`. Browser requests must use `credentials: 'include'` to send the session cookie. Production mode requires an HTTPS frontend origin, SMTP invitation delivery, a non-placeholder session secret, and a Secure/HttpOnly/SameSite=Lax `__Host-projectflow.sid` cookie. Failed logins are limited to 10 per 15 minutes per client IP; registrations are limited to 20 per hour. The default in-memory limiter store must be replaced by a shared store before horizontally scaled deployment.

## Current API

- `GET /api/health`
- `POST /api/auth/register` with `{name,email,password}`; passwords must contain 12–128 characters
- `POST /api/auth/login` with `{email,password}`
- `POST /api/auth/logout`
- `GET /api/auth/me`
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

Workspace access is enforced server-side using membership joins, and inaccessible cross-workspace resources return 404. Owners may manage admins and members; admins may invite, revoke, and remove members; owners cannot be reassigned or removed. Password reset, email verification, ownership transfer, distributed throttling, production mail-provider verification, deployment-header configuration, and broader security review remain required before a public launch.
