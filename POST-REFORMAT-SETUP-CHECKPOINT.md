# ProjectFlow Post-Reformat Setup Checkpoint

Date: 2026-10-24 (Asia/Taipei)

## Outcome

The local ProjectFlow development environment was restored after the Windows reinstallation. The frontend, backend, PostgreSQL database, migrations, automated suites, live persistence checks, and browser workflows were exercised successfully.

No deployment was attempted, no Git history was changed, and no application feature or design work was performed. The checked-in repository already contains the completed local Stage G2 readiness implementation; this recovery did not begin or extend Stage G2 and did not perform any hosted verification.

## Repository state

- Local repository: `C:\Users\EN\Documents\projectflow`
- Branch: `main`
- Remote: `https://github.com/Yukiiii2/projectflow.git`
- Verified commit: `0fdd103581f58dd1517452eb1834fd16590eace4`
- Commit subject: `chore: checkpoint ProjectFlow before Windows reinstall`
- `git fetch --prune origin` completed successfully.
- `HEAD...origin/main` divergence was `0 0` after the fetch.
- Recovery references reviewed: `README.md`, `POST-FORMAT-RECOVERY.md`, `FULLSTACK-SETUP.md`, the Stage A–G2 checkpoints, `docs/DEPLOYMENT-RUNBOOK.md`, `docs/DATABASE-RECOVERY.md`, both package manifests, both lockfiles, and both environment templates.

## Restored toolchain

| Tool | Verified version/state |
| --- | --- |
| Git for Windows | 2.55.0.windows.5 |
| Node.js | 24.20.0; satisfies the repository requirement of Node.js 20 or newer |
| npm | 11.19.0 |
| PostgreSQL client/server | 18.6 |
| PostgreSQL Windows service | `postgresql-x64-18`, running |
| PostgreSQL endpoint | `localhost:5432`, accepting connections |

## Dependencies and local configuration

- Root dependencies were restored with `npm.cmd ci` from `package-lock.json`.
- Backend dependencies were restored with `npm.cmd ci` from `backend/package-lock.json`.
- No unnecessary packages were added and no lockfile update was performed.
- Ignored `.env` and `backend/.env` files were recreated from the committed templates.
- The frontend points to `http://localhost:4000` for local development.
- The backend uses development mode, port 4000, exact frontend origin `http://localhost:5173`, preview email delivery, and optional local email verification.
- A fresh local session secret was generated. Database and session secrets were not printed, committed, or copied into this document.

## PostgreSQL recovery

- Dedicated login role: `projectflow`
- Dedicated database: `projectflow`
- Connection verified as role `projectflow` to database `projectflow`.
- The migration runner applied migrations 001 through 005 on the first run.
- An immediate repeat reported `0 applied, 5 already current`.
- The concurrent migration verifier confirmed five tracked migrations and advisory-lock serialization.
- After all live and browser QA cleanup, the database contained five migration-ledger rows and zero users, workspaces, projects, or tasks. No pre-existing data was reset or deleted.

## Service verification

At verification time:

- Express was listening on `http://localhost:4000`.
- `GET /api/health` returned status `ok`.
- Vite was serving `http://localhost:5173` with HTTP 200 and the expected application root.
- The live authentication verifier passed registration, Argon2id storage, PostgreSQL session persistence, protected routes, invalid credentials, unauthorized access, cookie attributes, and logout invalidation.
- The live readiness verifier passed hashed tokens, verification gating, password reset, session invalidation, lock-order concurrency, encrypted email delivery, and atomic source/outbox transactions.

## Automated verification

| Check | Result |
| --- | --- |
| Frontend Vitest | 8 files, 37 tests passed |
| Backend Vitest | 8 files, 39 tests passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed; Vite transformed 1,948 modules |
| Backend production build | Passed |
| Frontend dependency audit | 0 vulnerabilities |
| Migration replay | 0 applied, 5 already current |
| PostgreSQL migration verifier | Passed; concurrent runners serialized |
| Live authentication verifier | Passed after the API was started |
| Live readiness verifier | Passed |
| Authentication browser QA | Passed |
| Workspace browser QA | Passed |
| Projects/tasks browser QA | Passed |
| Kanban browser QA | Passed |
| Collaboration browser QA | Passed |
| Consolidated Stage F browser QA | Passed |

The browser workflows covered registration, session restoration, login/logout, workspace creation and isolation, project/task persistence, role enforcement, Kanban movement and recovery, invitations, assignments, comments, activity history, accessibility, security boundaries, and responsive layouts. Each workflow used uniquely named temporary records and completed its cleanup.

During an additional immediate full-suite rerun, repeated registration scenarios exhausted the development server's in-memory registration rate limit. The Kanban script then received HTTP 429 and timed out waiting for its post-registration heading. Backend logs established the cause; restarting only the local backend cleared that volatile test state, after which Kanban, collaboration, and the consolidated Stage F journey passed unchanged. No code or configuration workaround was applied.

## Dependency audit exception

**Resolved on 2026-10-24.** The dependency-security maintenance updated transitive `body-parser` to 1.20.9 and direct `zod` to 4.6.7, added Zod 4 PATCH-semantics regression coverage, and returned both package audits to zero vulnerabilities. See `DEPENDENCY-SECURITY-CHECKPOINT.md` for the complete evidence. The remainder of this section preserves the original recovery-time finding.

The current backend lockfile installs:

- `express@4.22.3` with `body-parser@1.20.8`
- `zod@3.25.76`

On 2026-10-24, `npm.cmd audit --omit=dev --audit-level=high` reported two high-severity advisories:

- `body-parser` before 1.20.9: denial of service involving trailing bytes after a compressed request body (`GHSA-27r3-jxmh-p828`).
- `zod` before 4.6.6: memory exhaustion while validating oversized constrained collections (`GHSA-mrhx-c7xc-m3w5`).

The frontend audit remains clean. No automatic dependency fix was applied during recovery: npm identifies the Zod remediation as a breaking major-version upgrade, and changing the application dependency graph is outside environment restoration. These advisories should be handled as a separately approved maintenance task with regression tests and review before any hosted release.

## Resume point

The local development environment is usable and the application behavior is restored. Before any deployment approval, resolve or explicitly assess the backend audit findings, then follow the existing Stage G2 checkpoint and deployment/recovery runbooks. Do not provision Render, Neon, Resend, monitoring, or backups without explicit approval.
