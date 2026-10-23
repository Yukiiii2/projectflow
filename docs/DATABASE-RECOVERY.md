# ProjectFlow database migration and recovery procedure

ProjectFlow uses ordered raw SQL files in `backend/sql`. The migration runner serializes execution with a PostgreSQL advisory lock and records each filename, SHA-256 checksum, and application time in `schema_migrations`.

## Safe migration rules

1. Never edit an applied migration. Add the next numbered file.
2. Prefer additive and backward-compatible schema changes.
3. Do not put `BEGIN` or `COMMIT` in migration files; the runner supplies one transaction per file.
4. Separate destructive cleanup into a later release after old code no longer depends on the data.
5. Test migrations against a disposable database or Neon branch first.
6. Use a migration role for schema changes and a lower-privilege runtime role for the application where the provider plan supports it.
7. The runtime role needs data access to `session` and `email_outbox`, but it does not need `CREATE TABLE`; both objects are migration-managed.

## Before a migration

1. Record the application commit and current migration ledger.
2. Create a Neon branch or restore point and note its retention deadline.
3. Export an encrypted logical backup when the data cannot be recreated.
4. Restore that backup into a disposable database at least quarterly and run health/read-write smoke tests.
5. Confirm the new application release is backward-compatible with the current schema.

## Apply and verify

```powershell
Set-Location backend
npm.cmd run db:migrate
npm.cmd run db:migrate
```

The first command should report only the newly applied migration. The second must report zero applied and every migration already current. A checksum mismatch means an applied file changed; stop and restore the original file rather than bypassing the check.

Verify:

```sql
SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name;
```

Then run `/api/health`, authentication, a representative authorized read/write workflow, and a cross-workspace denial check.

## Failed migration

The current file is rolled back automatically. Earlier committed files remain applied and recorded. Fix the failing new file only if it has no ledger row, test it on a disposable database, and rerun. Never delete a ledger row to force re-execution against production.

## Recovery

1. Stop writes or place the application in maintenance mode.
2. Restore the selected Neon point in time to a separate branch.
3. Compare migration ledger, row counts, and critical relationships.
4. Run the complete smoke workflow against the restored branch.
5. Estimate and communicate data created after the restore point.
6. Promote the verified branch or update the managed connection secret.
7. Rotate the database credential if exposure contributed to the incident.
8. Resume writes and monitor errors, latency, and data integrity.

Suggested portfolio targets are a 24-hour recovery point objective and a four-hour recovery time objective. These are operational goals, not guarantees; provider retention and the latest successful restore rehearsal determine actual recovery.
