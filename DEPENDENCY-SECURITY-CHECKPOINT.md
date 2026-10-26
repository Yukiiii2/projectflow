# ProjectFlow Dependency Security Maintenance Checkpoint

**Date:** 2026-10-24 (Asia/Taipei)
**Status:** Complete and verified locally; no deployment or infrastructure provisioning performed.

## Objective and outcome

The two high-severity backend dependency advisories discovered during post-reformat recovery were remediated with narrowly scoped supported updates:

| Dependency | Before | After | Relationship |
| --- | ---: | ---: | --- |
| `body-parser` | 1.20.8 | 1.20.9 | Transitive dependency of `express@4.22.3` |
| `zod` | 3.25.76 | 4.6.7 | Direct backend dependency |

The final frontend and backend audits report zero known vulnerabilities. Express remains on 4.22.3; no Express 5 migration, override, suppression, forced audit fix, or unrelated dependency upgrade was introduced.

## Advisory verification

### body-parser

- Advisory: [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), CVE-2026-111181.
- Impact: an unauthenticated compressed request with trailing bytes can cause an uncaught decompression error and terminate a process using affected parser defaults.
- Affected range: `<1.20.9` on the 1.x line.
- Patched version selected: `1.20.9`.
- Express 4.22.3 declares `body-parser@~1.20.5`, so 1.20.9 is accepted by the existing Express dependency range. Only the backend lockfile's transitive package record changed; no direct body-parser dependency was added.

### Zod

- Advisory: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), CVE-2023-54404.
- Impact: affected Zod versions can allocate an unbounded number of validation issues while processing oversized constrained collections, causing memory exhaustion.
- Affected range: `<4.6.6`.
- Patched version selected: `4.6.7`, the current supported npm release at maintenance time.
- The backend manifest now declares `zod@^4.6.7`, and the lockfile resolves 4.6.7.

## Zod 4 compatibility review

All backend Zod usage was reviewed: strict object parsing, normalized email transforms, UUID/date/enum validation, optional/default fields, partial updates, `ZodError` detection, and error formatting.

An isolated Zod 4 probe found a real migration incompatibility in task PATCH validation. Under Zod 3, `taskSchema.partial().parse({ status: 'done' })` returned only the supplied status. Under Zod 4, defaults nested in optional fields were applied during the partial parse, adding `description: ''` and `priority: 'medium'`. Without remediation, a status-only PATCH would silently overwrite an existing task description and priority.

The API now uses:

- a shared default-free task field shape;
- a create schema that applies the existing description/status/priority defaults; and
- a separate strict partial update schema that never injects create-time defaults.

Focused regression coverage now creates a task with a non-default description and priority, sends a status-only PATCH, and confirms those omitted fields remain unchanged. The test passed on Zod 3, failed after the Zod 4 dependency update with the predicted resets, and passed after the schema separation.

Zod 4 deprecates the instance `ZodError.flatten()` API. Error handling now uses supported `z.flattenError(error)` while preserving the public `{ formErrors, fieldErrors }` details shape. Focused API coverage verifies invalid registration returns a bounded HTTP 400 response with that structure.

## Files changed

- `backend/package.json`: `zod` range updated from `^3.24.2` to `^4.6.7`.
- `backend/package-lock.json`: resolves Zod 4.6.7 and body-parser 1.20.9.
- `backend/src/app.ts`: separates task creation/update schemas and uses supported Zod 4 error formatting.
- `backend/src/app.test.ts`: protects partial-update preservation and validation error structure.
- `POST-REFORMAT-SETUP-CHECKPOINT.md`: points to this completed remediation checkpoint.

## Verification evidence

| Check | Result |
| --- | --- |
| Clean backend `npm ci` from lockfile | Passed; 207 packages installed, 0 vulnerabilities |
| Focused API test on Zod 3 | 10/10 passed before dependency update |
| Focused API test immediately after Zod 4 update | Failed as expected: description and priority were reset |
| Focused API test after schema remediation | 10/10 passed |
| Backend Vitest | 8 files, 39 tests passed |
| Backend TypeScript | Passed |
| Backend production build | Passed |
| Backend production audit | 0 vulnerabilities |
| Frontend Vitest | 8 files, 37 tests passed |
| Frontend TypeScript | Passed |
| Frontend production build | Passed; 1,948 modules transformed |
| Frontend audit | 0 vulnerabilities |
| Migration replay | 0 applied, 5 already current |
| PostgreSQL migration verifier | Passed; five migrations tracked and concurrent runners serialized |
| Live authentication verifier | Passed |
| Live readiness verifier | Passed |
| API health | `ok` |
| Consolidated Stage F browser QA | Passed |

The live checks covered Argon2id registration/login, PostgreSQL session persistence, protected routes, logout invalidation, verification and password-reset flows, session invalidation, outbox atomicity, workspace boundaries, projects, tasks, Kanban, invitations, comments, accessibility, and responsive layouts. Temporary QA records were cleaned up; no existing database data was reset or deleted.

## Remaining risks and boundaries

- Dependency audits are point-in-time evidence and must continue to run in CI and before releases.
- Zod 4 changes APIs and semantics beyond the subset used by ProjectFlow. Current imports, schemas, inferred types, runtime validation, and error handling compile and pass the complete local regression suite; future schema work should follow the Zod 4 API.
- The existing 64 KB Express JSON limit bounds request bodies before Zod validation. This maintenance did not replace the broader need for external load, denial-of-service, or penetration testing.
- Hosted Render/Neon/Resend behavior remains outside this maintenance scope and still requires explicit deployment approval.

No unresolved npm audit advisory remains in either package at this checkpoint.
