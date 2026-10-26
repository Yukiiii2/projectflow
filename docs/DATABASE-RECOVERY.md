# ProjectFlow database migration and recovery procedure

ProjectFlow uses ordered raw SQL files in `backend/sql`. The migration runner serializes execution with a PostgreSQL advisory lock and records each filename, SHA-256 checksum, and application time in `schema_migrations`.

## Safe migration rules

1. Never edit an applied migration. Add the next numbered file.
2. Prefer additive, backward-compatible changes. Deploy code that tolerates both schema versions before a destructive cleanup.
3. Do not put `BEGIN` or `COMMIT` in migration files; the runner supplies one transaction per file.
4. Test every migration and recovery path against a disposable database or Neon branch first.
5. Use a migration role for schema changes and a lower-privilege runtime role where the provider supports it. The runtime role needs data access to `session` and `email_outbox`, but not `CREATE DATABASE` or `CREATE TABLE`.
6. Do not use destructive down migrations as routine rollback. Restore data separately and deploy compatible application code.
7. Use Neon's pooled TLS endpoint only for the application `DATABASE_URL`. Production migration commands require the direct, non-pooler TLS endpoint in the operator-only `MIGRATION_DATABASE_URL` because the runner holds a session advisory lock across transactions.

## Local logical-backup rehearsal

Run the committed verifier only against a non-production source while writes are quiescent:

```powershell
Set-Location backend
$env:POSTGRES_BIN_DIR = 'C:\Program Files\PostgreSQL\18\bin'
npm.cmd run verify:recovery:postgres
Remove-Item Env:POSTGRES_BIN_DIR
```

The verifier:

- checks that the source migration ledger exactly matches the numbered SQL files;
- runs `pg_dump` in custom format without putting credentials in command arguments;
- creates a unique database matching `projectflow_recovery_verify_<32 lowercase hex characters>`;
- restores with `--exit-on-error`, `--no-owner`, and `--no-privileges`;
- compares the migration ledger and row counts for all eleven application/runtime tables;
- reruns migrations and requires zero newly applied files;
- applies a deliberately failing probe migration and requires both its table and ledger row to roll back;
- performs a transactional read/write smoke test; and
- closes connections, drops only the validated disposable database, and removes its temporary dump.

The application runtime role should remain `NOCREATEDB`. For a controlled local rehearsal, either use a fully disposable PostgreSQL cluster whose test role owns the server, or supply `RECOVERY_ADMIN_DATABASE_URL` only to that command from a secure temporary environment. The administrative connection creates and drops the disposable database; the source/runtime connection performs the dump, restore, and validation. Never save the administrative URL in `.env`, shell history, CI output, or a tracked file.

An interrupted process can leave a temporary database or dump. Before retrying, list databases as an administrator, confirm the full strict prefix and random suffix, and remove only the identified disposable database. Treat every dump as sensitive: it can contain password hashes, session rows, encrypted outbox payloads, and user content. Production exports require encryption, private storage, access logging, retention, and a tested deletion policy.

## Before a hosted migration

1. Record the application commit, migration ledger, operator, start time, and change ticket.
2. Confirm the selected Neon branch is protected and note the configured history-retention window.
3. Create a Neon snapshot or recovery branch and record its identifier and expiry. Neon supports point-in-time restore within the configured history window; snapshots can be restored into a separate branch for inspection ([Neon restore overview](https://neon.com/blog/announcing-point-in-time-restore), [Neon snapshots](https://neon.com/blog/announcing-neon-snapshots-a-smoother-path-to-recovery)).
4. Export an encrypted logical backup to approved private storage when the data cannot be recreated.
5. Restore the selected artifact into a disposable branch/database and run this document's verification checks.
6. Confirm the new application release remains compatible with the current schema and that the previous application release remains compatible with the migrated schema.

## Apply and verify

```powershell
Set-Location backend
$env:NODE_ENV = 'production'
$env:MIGRATION_DATABASE_URL = '<direct Neon TLS URL from the password manager>'
npm.cmd run db:migrate
npm.cmd run db:migrate
Remove-Item Env:MIGRATION_DATABASE_URL
Remove-Item Env:NODE_ENV
```

Do not paste the real URL into a tracked script or transcript; assign it privately in the operator shell. The first command should report only newly applied migrations. The second must report zero applied and every numbered migration already current. A checksum mismatch means an applied file changed; stop and restore the original file rather than bypassing the check.

Verify the ledger, `/api/health`, authentication, a representative authorized read/write workflow, outbox processing, and a cross-workspace denial. Record the finish time and actual recovery/migration duration so the RTO is measured rather than assumed.

## Failed migration and application rollback

- The current migration file rolls back automatically. Earlier committed files remain applied and recorded.
- If the failing file has no ledger row, correct that new file, retest it on a disposable database, and rerun. Never delete a production ledger row to force re-execution.
- Roll back application code only when the prior release is compatible with the current database schema.
- If a migration committed but application verification failed, prefer a forward correction for schema-only defects. Use data restore only when the incident requires reverting data, and account explicitly for writes after the restore point.

## Incident recovery

1. Declare the incident owner and stop writes or enable provider maintenance mode.
2. Identify the last known-good timestamp/LSN and quantify the potential data-loss window.
3. Restore the selected Neon point or snapshot to a separate branch first; do not overwrite the affected branch for initial investigation.
4. Compare migration ledgers, critical row counts, key relationships, and business invariants.
5. Run health, authentication, workspace/project/task/Kanban/collaboration, email-outbox, authorization-denial, and read/write smoke checks against the restored branch.
6. Measure elapsed recovery time and communicate the actual RPO/RTO and any unrecovered writes.
7. Promote the verified branch or update the managed database secret only after approval.
8. Rotate credentials if exposure contributed to the incident, resume writes, and monitor errors, latency, connections, outbox failures, and integrity checks.
9. Preserve incident evidence and perform a post-incident review before deleting the old branch or recovery artifacts.

Target portfolio objectives are RPO 24 hours and RTO 4 hours. These are targets, not guarantees. Actual capability is bounded by the configured Neon retention, logical-export schedule, latest successful restore rehearsal, operator access, and measured rehearsal duration.

## Rehearsal schedule and evidence

- CI: every change restores an ephemeral PostgreSQL service backup and exercises migration rollback.
- Before every production migration: create and identify a provider restore point/snapshot.
- Quarterly, and after material schema/provider changes: restore the production-class artifact into a disposable Neon branch, run the complete smoke workflow, record actual RPO/RTO, and remove the disposable branch after review.
- Evidence must contain timestamps, commit and migration names, artifact/branch identifiers, row-count totals, pass/fail outcomes, and cleanup confirmation, but no URLs, credentials, bearer tokens, message bodies, or dump contents.
