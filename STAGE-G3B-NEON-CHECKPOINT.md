# ProjectFlow Stage G3B — Neon Cloud Database Integration Checkpoint

**Date:** 2026-10-27 (Asia/Taipei)

**Baseline:** `018b1a4b7cc1615d5432caf0e19e49615db71477` (`feat: prepare free-tier deployment compatibility`), synchronized with `origin/main`

**Status:** **Stage G3B database initialization and least-privilege runtime verification complete and rechecked for Stage G3C.** The confirmed Neon Free Singapore target has exactly the five existing ProjectFlow migrations, retains a protected direct migration owner, and uses a dedicated SQL-created limited role for pooled application traffic. Schema, health, authentication, authorization, workflow, migration-boundary, and cleanup checks passed. Render and Resend remain unconfigured and no deployment has occurred.

No Neon credential, URL, password, token, hostname, or database name was printed or added to the repository/checkpoint. Authorized cloud mutations were limited to the five schema migrations, the dedicated `projectflow_runtime` role and grants, and temporary QA records that were verified deleted. No reset, destructive database operation, Render deployment, or Resend configuration was performed.

## Scope reviewed

- Stage G1, Stage G2, and Stage G3A plans/checkpoints
- `render.yaml`, `backend/.env.example`, root/backend manifests, and GitHub Actions
- `backend/src/config.ts`, `db.ts`, `migration-config.ts`, `migrate.ts`, `migrations.ts`, and the PostgreSQL verification scripts
- all five files in `backend/sql`
- `docs/DEPLOYMENT-RUNBOOK.md` and `docs/DATABASE-RECOVERY.md`
- current Neon connection, pooling, TLS, extension, and Free-plan documentation

## Existing application configuration

No application code change is required for the intended Neon topology.

| Purpose | Environment variable | Connection type | Validation |
| --- | --- | --- | --- |
| Express runtime, sessions, and application queries | `DATABASE_URL` | Neon pooled URL | Production requires PostgreSQL and `sslmode=require`, `verify-ca`, or `verify-full` |
| Migration runner and migration verifier | `MIGRATION_DATABASE_URL` | Neon direct URL | Production requires PostgreSQL, approved TLS mode, and rejects a `-pooler` hostname |

`createDatabasePool` passes `DATABASE_URL` to a standard `node-postgres` pool. The migration commands use `loadMigrationDatabaseUrl`, so production cannot silently fall back to the runtime pooler.

The migration runner checks out one dedicated connection, obtains `pg_advisory_lock(73920126)`, creates/reads the checksum ledger, applies each pending file in its own transaction, and unlocks before releasing the connection. Neon uses PgBouncer transaction pooling for pooled endpoints and explicitly does not support session-level advisory locks there. Therefore:

- normal web application traffic uses the pooled hostname containing `-pooler`;
- migrations use the direct hostname without `-pooler`; and
- migrations are never added to application startup.

## Neon Free compatibility

- Neon supports standard PostgreSQL wire-protocol clients including `node-postgres`.
- Neon requires TLS. The generated strings currently include `sslmode=require` and may also include `channel_binding=require`; preserve the Neon-generated query parameters.
- Pooled connections are the documented choice for web applications and high connection churn.
- Direct connections are the documented choice for schema migrations and tasks needing persistent session state.
- `pgcrypto` is supported by Neon and can be enabled with the exact statement already present in migration `001`.
- Neon Free is sufficient for the initial portfolio database within its current storage, compute, branch, and restore limits. Recheck the live plan before public launch.

## How to locate both connection strings

Complete these actions manually in the Neon Console. Do not paste either connection string into chat.

1. Sign in at the Neon Console and select the intended **ProjectFlow** project.
2. Click **Connect** in the Console navigation to open **Connect to your branch**.
3. Select the intended branch, initially `main` unless you deliberately created another empty production branch.
4. Select the intended compute.
5. Select the intended database. Record only its non-secret name in the deployment evidence.
6. Select the database role that will own and apply the initial schema migrations.
7. Turn **Connection pooling off**.
8. Copy the resulting direct URL privately. Its hostname must not contain `-pooler`. Store it as `MIGRATION_DATABASE_URL` only in the protected migration environment.
9. Turn **Connection pooling on**. Neon enables this view by default for new projects.
10. Copy the resulting pooled URL privately. Its hostname must contain `-pooler`. Store it as `DATABASE_URL` for runtime use.
11. Confirm both strings identify the same project branch and database, use port 5432 implicitly or explicitly, and retain the Neon-provided TLS query parameters.

For the simplest controlled initialization, both strings may initially use Neon's generated owner role. Before Render deployment, create a separate runtime login **with SQL**, not with the Console, CLI, or API: Neon grants `neon_superuser` membership to roles created through those management interfaces. The SQL-created login should receive only database connect, `public` schema usage, and the required table DML privileges. Then obtain a new **pooled** URL using that limited role. Keep the owner/direct URL only for migrations and protected operator tasks.

## Private credential configuration

The repository ignores `.env`, `.env.*`, `backend/.env`, and `backend/.env.*`, while explicitly allowing only the committed example files. Existing local `.env` files were detected but their contents were not read or changed.

Use a dedicated ignored file rather than overwriting the working local-development file:

`backend/.env.neon`

Enter the values manually in a local editor or password-manager workflow:

```dotenv
NODE_ENV=production
DATABASE_URL=<pooled Neon TLS URL>
MIGRATION_DATABASE_URL=<direct Neon TLS URL>
```

Safety checks that do not reveal values:

```powershell
git check-ignore -v backend/.env.neon
git status --short
```

The first command must identify an ignore rule. The second must not list `backend/.env.neon`.

Later, Render receives only the pooled `DATABASE_URL` through its secret controls. Do not configure `MIGRATION_DATABASE_URL` on the Render web service. Do not place either URL in GitHub Actions, screenshots, tickets, shell command arguments, or this checkpoint.

## Five-migration review

| Migration | Empty-database effect | Safety finding |
| --- | --- | --- |
| `001_init.sql` | Enables `pgcrypto`; creates users, workspaces, membership, projects, tasks, comments, and base indexes | Additive; `CREATE ... IF NOT EXISTS`; UUID defaults use supported `gen_random_uuid()` |
| `002_collaboration.sql` | Creates workspace invitations, activity events, and collaboration indexes | Additive; foreign keys and role checks preserve authorization model |
| `003_account_security.sql` | Adds verification/session-version fields and hashed authentication-token storage | Existing-user backfill is a no-op on an empty database; no plaintext token column |
| `004_runtime_operations.sql` | Enforces one active token per purpose; creates PostgreSQL session and encrypted-email-outbox storage | Additive; cleanup statement is a no-op on an empty database |
| `005_email_outbox_retention.sql` | Adds required outbox expiry and the bounded retry-ready index | Backfill is a no-op on an empty outbox; completes current runtime contract |

The resulting schema has eleven application/runtime tables plus `schema_migrations`. The migration ledger stores filename, SHA-256 checksum, and application time. Applied migration files must never be edited.

Focused local evidence on 2026-10-27:

- `migrations.test.ts` and `migration-config.test.ts`: **9/9 passed**;
- ordering, transactions, rollback, checksum rejection, advisory unlock, production direct-URL selection, pooled-host rejection, and TLS enforcement are covered; and
- GitHub Actions run `40350205760` previously passed the real PostgreSQL concurrent-migration and isolated recovery job on Node.js 24.

## Authorized Neon execution results

The user confirmed the Neon Free Singapore target, privately configured ignored file, pooled/direct URL assignment, credential storage, empty-database intent, recovery branch, and permission to run the five migrations plus the documented verification steps.

### Redacted target preflight

The preflight emitted only pass/fail facts:

- `backend/.env.neon` is ignored by `backend/.env.*` and remained untracked;
- both values are complete PostgreSQL URLs with an accepted TLS mode;
- the runtime hostname contains `-pooler` and the migration hostname does not;
- removing `-pooler` produces the same compute hostname;
- URL database paths match;
- the endpoint matches the Singapore region pattern;
- both connections reached the same writable PostgreSQL 18 database;
- both node-postgres client streams were encrypted `TLSSocket` instances;
- the public schema contained zero tables and neither `schema_migrations` nor `users` existed; and
- the direct connection successfully obtained and released ProjectFlow's session advisory lock.

The initial diagnostic attempted to use `pg_stat_ssl`, which reported the proxy/backend leg rather than the client/proxy leg and therefore returned false for both Neon URLs. The run stopped before migrations as designed. Direct inspection then confirmed both node-postgres client streams were TLS encrypted, and the full preflight passed using that correct boundary.

The installed `pg`/`pg-connection-string` version also warns that its current handling of `sslmode=require` and `verify-ca` is equivalent to `verify-full`, but a future `pg` major will adopt weaker standard libpq semantics for those modes. ProjectFlow remains encrypted and verified on the installed version; before upgrading to `pg` 9, explicitly review `sslmode=verify-full` versus Neon's current generated-string guidance.

### Migration evidence

| Step | Result |
| --- | --- |
| First `db:migrate` through direct URL | **5 applied, 0 already current** |
| Second `db:migrate` replay | **0 applied, 5 already current** |
| `verify:migrations:postgres` | **Passed:** 5 tracked migrations, concurrent runners serialized |
| Local file-to-ledger comparison | All five filenames and SHA-256 checksums matched |
| Migration failure/reset/delete actions | None |

### Schema and health evidence

- PostgreSQL major version: 18; database timezone: GMT.
- `SELECT 1` health query passed through the pooled runtime URL.
- `pgcrypto` is installed.
- All eleven required ProjectFlow application/runtime tables exist.
- Required active-token, session-expiry, and outbox-ready indexes exist.
- Before temporary QA, all eleven application/runtime tables contained zero rows.

### Authentication and temporary-record evidence

- `verify:readiness:live` passed against the pooled Neon URL: hashed tokens, verification gate, password reset/session invalidation, concurrency behavior, encrypted outbox processing, and source/outbox atomicity.
- A local development-mode Express server used the pooled Neon URL with preview email delivery only; `/api/health` returned HTTP 200.
- `verify:auth:live` passed: registration, Argon2id password storage/verification, PostgreSQL-backed sessions, protected routes, invalid-credential handling, cookie attributes, and logout invalidation.
- The temporary server logged graceful `SIGINT` shutdown and no process remained on port 4000.
- Final cleanup verification found zero rows across all eleven application/runtime tables, including zero `session` and zero `email_outbox` rows.
- The migration ledger remained exactly five rows.

### Least-privilege runtime-role remediation

The ignored `backend/.env.neon` pooled `DATABASE_URL` now uses the SQL-created login `projectflow_runtime`; the direct `MIGRATION_DATABASE_URL` and schema owner were not changed. The password was supplied privately and was never printed or added to a tracked file.

The runtime role has these explicit ProjectFlow privileges:

- `CONNECT` to the intended database;
- `USAGE` on schema `public`;
- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the eleven application/runtime tables; and
- matching default table privileges for future tables created by the migration owner in `public`.

It has no table ownership, role memberships, `neon_superuser`, `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, or `CREATE` on schema `public`. It has no access to `schema_migrations` and received no sequence privileges because the current schema has no sequences. Neon/PostgreSQL grants database `TEMPORARY` to `PUBLIC`; the runtime role inherits that provider/database default. It was not granted directly, and removing it would require a database-wide `PUBLIC` ACL change that could affect unrelated roles, so that global change was deliberately not made.

Redacted denial checks confirmed that the runtime role cannot read the migration ledger, create a persistent table, or alter `users`. The direct migration role still owns all eleven tables, can create schema objects, and can acquire/release ProjectFlow's session advisory lock.

Runtime DML was verified across users, PostgreSQL sessions, workspaces, memberships, projects, tasks, comments, activity events, invitations, authentication tokens, and the encrypted email outbox. The rollback-only permission probe verified both Kanban status transitions and left no records.

API-level verification through a temporary local Express server confirmed registration, PostgreSQL session persistence, workspace and project creation, task creation, `todo` → `in_progress` → `done` Kanban transitions, workspace task listing, and invitation create/list/revoke. `verify:auth:live` and `verify:readiness:live` passed through the limited pooled connection, including Argon2id authentication, verification/reset semantics, session invalidation, concurrency behavior, encrypted outbox processing, and atomic source/outbox transactions.

The direct migration replay reported `0 applied, 5 already current`, and the concurrent migration verifier reported five tracked migrations with serialized runners. Focused application, collaboration, authentication-security, email-outbox, migration, and migration-configuration tests passed **29/29** across six files; backend TypeScript checking also passed.

### Final review re-verification

Immediately before closing Stage G3B, the two focused migration/configuration test files passed **9/9**. A fresh redacted database check also reconfirmed pooled and direct client-side TLS, identical target database identity, writable target state, the exact five migration names, all eleven required tables, zero temporary application/runtime rows, and successful direct session advisory-lock acquisition and release.

## Safest initialization procedure for the empty Neon database

This procedure was executed after the user confirmed the intended target and explicitly approved migration execution. It is retained as the operator record; do not repeat it against another target without a new confirmation.

1. Record the reviewed commit, Neon project name, region, branch name, database name, selected role, and start time without recording a URL or password.
2. Confirm the target is the intended new empty database. Do not rely on project naming alone.
3. In the Neon SQL Editor, perform a read-only preflight against the selected branch/database:

   ```sql
   SELECT current_database(), current_user;
   SELECT to_regclass('public.schema_migrations') AS migration_ledger,
          to_regclass('public.users') AS users_table;
   ```

   For a truly empty ProjectFlow database, both object results should be `NULL`. If either exists, stop and review rather than resetting or deleting anything.
4. Create a pre-migration Neon branch or other provider-supported recovery point and record only its identifier.
5. Verify the private file is ignored and the two URL host patterns/TLS modes are correct without printing the strings.
6. From `backend`, point dotenv at the private file and run the migration command once:

   ```powershell
   Set-Location backend
   Remove-Item Env:DATABASE_URL,Env:MIGRATION_DATABASE_URL,Env:NODE_ENV -ErrorAction SilentlyContinue
   $env:DOTENV_CONFIG_PATH = '.env.neon'
   npm.cmd run db:migrate
   ```

   Expected result for a new empty target: `5 applied, 0 already current`.
7. Run the same command a second time. Expected result: `0 applied, 5 already current`.
8. Run the migration verifier through the same direct connection:

   ```powershell
   npm.cmd run verify:migrations:postgres
   ```

   Expected result: five tracked migrations and successful concurrent-runner serialization.
9. Remove the dotenv selector from the operator shell when finished:

   ```powershell
   Remove-Item Env:DOTENV_CONFIG_PATH
   ```

10. Never run `verify:recovery:postgres` against the Neon production database. That command intentionally creates, restores, and drops an isolated database and belongs only in a disposable environment with explicitly scoped administration.

If any migration fails, stop. The current file rolls back, previously committed files remain recorded, and the session lock is released. Do not delete ledger rows, edit an applied SQL file, reset the database, or rerun with a pooled URL.

## Prepared connectivity and verification commands

### Read-only pooled/direct connectivity and TLS check

After the private file exists, run this from `backend`. It reports only booleans and does not print URLs, passwords, role names, hostnames, or database names.

```powershell
Remove-Item Env:DATABASE_URL,Env:MIGRATION_DATABASE_URL,Env:NODE_ENV -ErrorAction SilentlyContinue
node --env-file=.env.neon --input-type=module -e "import pg from 'pg'; const runtime=new URL(process.env.DATABASE_URL); const migration=new URL(process.env.MIGRATION_DATABASE_URL); if(!runtime.hostname.includes('-pooler.')) throw new Error('DATABASE_URL is not pooled'); if(migration.hostname.includes('-pooler.')) throw new Error('MIGRATION_DATABASE_URL is pooled'); const values=[]; for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL']){const pool=new pg.Pool({connectionString:process.env[key],max:1}); try{const result=await pool.query(\"SELECT current_database() AS database, EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls\"); values.push(result.rows[0]); console.log(key + ': connection=true tls=' + result.rows[0].tls)} finally{await pool.end()}} console.log('same_database=' + (values[0].database===values[1].database))"
```

Required output:

- both connections report `connection=true tls=true`;
- `same_database=true`;
- the runtime URL passed the pooled-host check; and
- the migration URL passed the direct-host check.

### Migration ledger check

After approved migration execution, use the Neon SQL Editor or a protected client:

```sql
SELECT name, applied_at
FROM schema_migrations
ORDER BY name;
```

The result must contain exactly:

1. `001_init.sql`
2. `002_collaboration.sql`
3. `003_account_security.sql`
4. `004_runtime_operations.sql`
5. `005_email_outbox_retention.sql`

Do not copy checksums, connection details, or query metadata into public logs.

### Database health and runtime object checks

```sql
SELECT 1 AS database_health;
SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';
SELECT
  to_regclass('public.users') IS NOT NULL AS users_ready,
  to_regclass('public.session') IS NOT NULL AS sessions_ready,
  to_regclass('public.email_outbox') IS NOT NULL AS outbox_ready,
  to_regclass('public.idx_auth_tokens_one_active') IS NOT NULL AS active_token_index_ready;
```

The database health result must be `1`, `pgcrypto` must be present, and every readiness boolean must be true.

### Authentication compatibility after migration

After explicit approval, use a separate local development-mode environment file containing the pooled `DATABASE_URL`, an independent local-only session secret, local frontend origin, preview delivery, and no Resend credential. Then:

1. start the backend locally against the pooled Neon URL;
2. request `http://localhost:4000/api/health` and require HTTP 200;
3. run `npm.cmd run verify:auth:live` to verify Argon2id storage, PostgreSQL sessions, protected routes, cookies, and logout cleanup; and
4. run `npm.cmd run verify:readiness:live` to verify hashed auth tokens, verification/reset semantics, encrypted outbox behavior, atomic transactions, and cleanup.

Both live scripts create unique synthetic records and include cleanup, but they are data-writing checks. Run them only after the migration approval and only against the confirmed ProjectFlow database. Stop if cleanup reports any remaining record.

## Approval boundary — satisfied for this target

Before Codex made any Neon connection or database change, the user confirmed all of the following without sharing secrets:

- the Neon project is on the Free plan;
- the intended project name, region, branch name, and database name;
- `backend/.env.neon` exists and is ignored;
- `DATABASE_URL` contains the pooled URL and `MIGRATION_DATABASE_URL` contains the direct URL;
- the target is a new empty ProjectFlow database;
- a pre-migration recovery branch/point exists; and
- explicit approval is granted to run the five migrations and the listed verification steps.

The accepted approval covered the five existing migrations and the documented connectivity, ledger, health, authentication, and temporary-record checks. It did not authorize resets, unrelated databases, role provisioning, Render, Resend, or Stage G3C.

Reusable approval form for any future target:

> I confirm the Neon Free project `<non-secret project name>`, region `<region>`, branch `<branch>`, and database `<database>` are the intended new empty ProjectFlow target. `backend/.env.neon` is configured and ignored with pooled `DATABASE_URL` and direct `MIGRATION_DATABASE_URL`. A pre-migration recovery branch/point exists. You may run the five ProjectFlow migrations and the documented connectivity, ledger, health, and authentication checks.

Do not include connection strings, usernames, passwords, tokens, or screenshots in the approval message.

## Remaining deployment requirements

- Hosted backup/restore capability and monitoring remain future deployment gates.
- Review the documented `pg` 9 TLS-mode semantic change before that future dependency upgrade.
- The inherited database-wide `PUBLIC TEMPORARY` privilege remains a documented PostgreSQL baseline; it was not expanded or changed for this role.
- Render and Resend remain untouched until their separately approved stages.

## Stage G3C finalization recheck — 2026-10-27

The approved limited runtime connection and unchanged direct migration connection were rechecked before Render preparation. Redacted probes confirmed:

- pooled and direct connections both negotiate TLS, target the same intended database, and authenticate as different roles;
- `projectflow_runtime` remains `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, owns no objects, belongs to no elevated role, cannot create in `public`, and cannot read or modify `schema_migrations`;
- the runtime role retains only `CONNECT`, schema `USAGE`, and exact `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants on the eleven application/session/outbox tables; and
- only the direct migration role can take the session advisory lock and perform migration DDL.

PostgreSQL grants database `CONNECT` and `TEMPORARY` to `PUBLIC` by default. Privileges are additive, so a direct per-role `REVOKE TEMPORARY` would not override the inherited `PUBLIC` grant. Removing it would require `REVOKE TEMPORARY ... FROM PUBLIC`, a database-wide policy change affecting every role. ProjectFlow does not depend on temporary objects, and the runtime role cannot create persistent objects in `public`; no additional change is necessary for this release. Revisit the database-wide default only as a separately reviewed hardening policy.

Fresh evidence:

- focused authentication, migration, migration-configuration, and production-readiness tests: 4 files, 26 tests passed;
- live authentication/readiness workflow: verification gate, hashed tokens, password reset, session invalidation, concurrency, encrypted outbox, and atomic source/outbox transactions passed;
- direct migration replay: 0 applied, 5 already current; concurrent runner serialization passed; and
- Stage F/G3C temporary-user count after cleanup: 0.

No role, grant, schema, migration, or existing application record was changed during this recheck.

## Provider references checked

- [Connect from any application](https://neon.com/docs/connect/connect-from-any-app): current Console steps, pooled/direct toggle, connection-string composition, and TLS requirement.
- [Connection pooling](https://neon.com/docs/connect/connection-pooling): pooled hostname format, web-versus-migration guidance, transaction pooling, and unsupported session advisory locks.
- [Manage roles](https://neon.com/docs/manage/roles): default-owner privileges and the distinction between management-interface and SQL-created roles.
- [Manage database access](https://neon.com/docs/manage/database-access): least-privilege database, schema, table, and sequence grants.
- [`pgcrypto`](https://neon.com/docs/extensions/pgcrypto): Neon support and the required `CREATE EXTENSION IF NOT EXISTS pgcrypto` statement.
- [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html): additive role, membership, and `PUBLIC` privilege behavior.
- [`REVOKE`](https://www.postgresql.org/docs/current/sql-revoke.html): database-wide revocation semantics.

Stage G3B database initialization, least-privilege runtime configuration, and final recheck are complete. Render still has no credentials and no cloud deployment has occurred.
