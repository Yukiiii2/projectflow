# ProjectFlow Stage G2 Part 3 Checkpoint

**Date:** 2026-10-26 (Asia/Taipei)

**Baseline:** `ebc09ceb9fb608e63437893795195dd98291b174` (`feat: complete Stage G2 email readiness`)

**Status:** Part 3 implemented and locally verified; GitHub Actions and provider-specific recovery, delivery, monitoring, and deployment checks remain hosted-only approval gates

## Scope completed

Stage G2 Part 3 covered:

- safe PostgreSQL logical backup and isolated restoration verification;
- migration replay, checksum, serialization, rollback, and recovery readiness;
- GitHub Actions coverage for tests, TypeScript checks, builds, dependency audits, migrations, and logical restore;
- structured-log and basic monitoring/alert-response readiness;
- final deployment configuration and blocker checklists; and
- explicit Render, Neon, and Resend integration requirements.

No deployment, cloud resource, paid service, DNS record, provider credential, production secret, Git history, or active development data was created, changed, or exposed. Stage G2 stops after Part 3.

## Database backup and restore verification

Added `npm run verify:recovery:postgres`. The verifier:

- requires the source `schema_migrations` ledger to match all five numbered SQL files;
- invokes PostgreSQL client tools without placing the database username, password, or URL in process arguments;
- writes a custom-format dump to a unique operating-system temporary directory;
- permits database creation/deletion only for names matching `projectflow_recovery_verify_<32 lowercase hex characters>`;
- restores with exit-on-error and without source ownership or privilege statements;
- compares the source and restored migration ledger plus row counts for eleven application/runtime tables;
- reruns migrations and requires zero new applications;
- runs a deliberately failing migration and proves its table and ledger row both roll back;
- performs a transactional read/write smoke check; and
- closes connections, force-drops only the guarded disposable database, and removes the temporary dump.

Focused regression coverage verifies strict database-name validation, safe identifier quoting, decoded libpq environment values, credential-free tool arguments, Windows tool-path resolution, restore-target selection, and preservation of both verification and cleanup failures.

The local `projectflow` runtime role remains correctly restricted with `NOCREATEDB`. The successful rehearsal therefore used a short-lived PostgreSQL 18 cluster bound only to `127.0.0.1:55432`. Five migrations were applied to its disposable source, the dump was restored into a separately generated disposable database, all checks passed, and the cluster directory was stopped and removed. The active development database was never a restore target.

After all live checks, the active development database still had five migration-ledger rows, zero users/workspaces/projects/tasks/outbox rows, and zero databases with the recovery-verifier prefix.

## Migration rollback and recovery policy

The migration runner remains unchanged: it uses a PostgreSQL advisory lock, SHA-256 ledger, lexical ordering, one transaction per pending file, checksum rejection, and cleanup in `finally`.

The recovery runbook now distinguishes:

- automatic rollback of the currently failing, unrecorded migration;
- forward correction for an already committed schema change where possible;
- application rollback only across compatible schema boundaries; and
- provider restore only after separate-branch validation and explicit accounting for post-restore-point writes.

Production runtime roles must not receive `CREATEDB`. A separate, temporary administrative recovery connection or a disposable server/branch owns recovery-database lifecycle. Production dumps are classified as sensitive and require encrypted private storage, access logging, retention, deletion, and recurring restore evidence.

## CI/CD readiness

The existing least-privilege GitHub Actions workflow now covers:

| Job | Gates |
| --- | --- |
| Frontend | lockfile install, 37-test suite, TypeScript, Vite production build, high-severity audit |
| Backend timezone matrix | full backend suite in UTC, America/Los_Angeles, and Asia/Taipei |
| Backend build | lockfile install, TypeScript, compiled build, high-severity audit |
| PostgreSQL 16 | concurrent migration serialization, ledger/runtime objects, PostgreSQL client tools, isolated dump/restore, idempotent replay, failed-migration rollback, and cleanup |

Workflow permissions remain `contents: read`, concurrent runs for the same ref are cancelled, and no production secret is referenced. `render.yaml` remains unchanged with `autoDeployTrigger: off`, the combined lockfile build, compiled backend start, `/api/health`, the Singapore Starter plan, and managed-secret placeholders.

Database migrations remain a protected operator step. No application-startup migration hook was added. A Render pre-deploy migration can be considered only after hosted backup/restore and migration-role verification.

## Logging and monitoring readiness

The existing structured JSON logger and tests remain the application baseline: request ID, method, redacted path, status, duration, Cloudflare Ray ID, severity, and named events are emitted without request bodies, cookies, credentials, database URLs, or bearer tokens.

The deployment runbook now defines initial alert sources, thresholds, response actions, and ownership for:

- external and Render health failures;
- build/deploy/pre-deploy failures;
- sustained 5xx and `request_failed` events;
- `email_outbox_delivery_abandoned`;
- abnormal 401/403/429 volume;
- Neon connection/storage/compute pressure; and
- Resend bounce/complaint/suppression changes.

Hosted launch requires a named primary and fallback owner, tested notification delivery, escalation/acknowledgement procedures, and confirmation that the log platform preserves structured fields and redaction.

## Local verification evidence

| Check | Result |
| --- | --- |
| Recovery safety tests | **5/5 passed** |
| Complete frontend suite | 8 files, **37/37 passed** |
| Complete backend suite | 9 files, **55/55 passed** |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Combined production build | Passed; Vite transformed **1,948 modules**, backend compiled |
| Production bundle scan | No `http://localhost:4000` in frontend output |
| Frontend dependency audit | **0 vulnerabilities** |
| Backend dependency audit | **0 vulnerabilities** |
| Active PostgreSQL migration verifier | Passed; **5** tracked migrations, concurrent runners serialized |
| Active migration replay | **0 applied, 5 already current** |
| Live authentication verifier | Passed; Argon2id, PostgreSQL sessions, authorization, cookies, logout |
| Live Stage G2 readiness verifier | Passed; token hashing, verification, reset/session invalidation, outbox encryption/atomicity |
| Isolated PostgreSQL 18 restore rehearsal | Passed; **5 migrations, 11 table counts, rollback probe, read/write smoke** |
| Disposable recovery cleanup | Passed; temporary cluster removed, recovery-prefixed database count **0** |

Local tool versions used for this checkpoint were Node.js `24.20.0`, npm `11.19.0`, and PostgreSQL client/server tools `18.6`. GitHub Actions remains pinned to Node.js 20 and PostgreSQL 16 for the hosted compatibility gate.

The intentional generic-error paths in backend/live tests emitted sanitized `request_failed` JSON events containing only the error class.

## Provider requirements and hosted-only blockers

### GitHub

1. Push only after review, then require all four workflow job groups on `main`.
2. Confirm the new PostgreSQL client installation and restore rehearsal pass on the Ubuntu hosted runner.
3. Configure branch protection without exposing production credentials to pull-request jobs.

### Render

1. Review and apply `render.yaml` only after explicit provisioning approval.
2. Verify the actual proxy chain, exact HTTPS origin, secure cookie, CSP/HSTS/cache headers, API/static routing, health behavior, graceful shutdown, structured logs, and outbound SMTP TLS.
3. Keep automatic deploys off through the first manual release and rollback rehearsal; consider checks-gated deploys afterward.

### Neon

1. Select the region, pooled TLS endpoint, protected production branch, history retention, connection limits, and separate runtime/migration privileges where supported.
2. Create a snapshot or recovery point, restore it into a separate branch, run the full hosted smoke workflow, measure actual RPO/RTO, and remove it only after review.
3. Configure encrypted logical-export storage, access controls, retention/deletion, failure alerts, and a quarterly restore schedule before storing non-recreatable data.

### Resend

1. Verify the sending domain and exact SPF/DKIM records.
2. Create a sending-only, domain-restricted credential where available and store it only in Render.
3. Verify SMTP port 465/TLS from Render and complete invitation, verification, and password-reset receipt/expiry/single-use checks with controlled recipients.
4. Validate delivery, delay, bounce, complaint, and suppression visibility and decide whether signed webhooks are operationally required.

### Monitoring and operations

1. Select the external uptime/log/error-monitoring services and configure `/api/health` probing.
2. Test every required alert route and escalation owner without including secrets, personal data, or bearer URLs.
3. Measure the hosted recovery rehearsal against the target RPO of 24 hours and RTO of 4 hours; these remain objectives, not guarantees.
4. Complete the public-origin synthetic workflow and rollback drill before any production-readiness claim.

## Files changed

- `.github/workflows/ci.yml`
- `README.md`
- `backend/README.md`
- `backend/package.json`
- `backend/src/database-recovery.ts`
- `backend/src/database-recovery.test.ts`
- `backend/src/verify-database-recovery-postgres.ts`
- `docs/DATABASE-RECOVERY.md`
- `docs/DEPLOYMENT-RUNBOOK.md`
- `STAGE-G2-PART-3-CHECKPOINT.md`

No package dependency, lockfile, SQL migration, application route, frontend source, environment file, or Render Blueprint change was required.

## Stop boundary

Stage G2 Part 3 stops here. The changes remain local and uncommitted for review. Nothing was pushed. No deployment, provider provisioning, DNS change, paid-service action, secret entry, live alert configuration, production backup scheduling, or Stage G2 follow-on work was performed.
