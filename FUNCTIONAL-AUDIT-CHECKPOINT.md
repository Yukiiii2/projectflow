# ProjectFlow Full Functionality Audit Checkpoint

**Date:** 2026-10-26 (Asia/Taipei)
**Status:** Complete and verified locally; ready for GitHub synchronization. No deployment or infrastructure provisioning was performed.

## Outcome

ProjectFlow was audited against the current source, migrations, Stage A–G2 checkpoints, recovery documentation, browser workflows, and real PostgreSQL-backed behavior. All implemented release-scope workflows passed. No reproducible application defect or broken in-scope control remains.

The audit found one broken development-only QA workflow: `visual:qa` still targeted the obsolete production-preview port and mocked only the pre-Stage-C API surface. It now targets the normal Vite development origin and supplies current project, task, and member fixtures. The original workflow failed consistently; after the focused correction it passed all 12 visual states.

The dependency-security maintenance performed immediately before this audit is included in the verified change set: `body-parser` is 1.20.9 and Zod is 4.6.7, both package audits are clean, and the Zod 4 PATCH-semantics regression is covered.

## Repository and environment

- Repository: `C:\Users\EN\Documents\projectflow`
- Branch: `main`
- Remote: `https://github.com/Yukiiii2/projectflow.git`
- Pre-audit baseline: `0fdd103581f58dd1517452eb1834fd16590eace4`
- Pre-commit comparison after `git fetch --prune origin`: `HEAD...origin/main` = `0 0`
- Git: 2.55.0.windows.5
- Node.js: 24.20.0
- npm: 11.19.0
- PostgreSQL client/server: 18.6
- Installed backend graph: Express 4.22.3 → body-parser 1.20.9; Zod 4.6.7
- Migration ledger: five tracked migrations; replay reported `0 applied, 5 already current`

Local `.env` files, generated browser artifacts, dependencies, builds, and the audit execution ledger remain ignored. No environment secret is tracked or recorded here.

## Feature matrix

| Area | Classification | Current-run evidence | Notes |
| --- | --- | --- | --- |
| Registration, login, session restoration, logout | Working | Frontend/backend tests, live auth verifier, IAB journey, auth QA, Stage F QA | Argon2id hashes and PostgreSQL sessions verified |
| Email verification and password recovery | Working with Limitations | Auth/security tests, live readiness verifier, IAB non-enumerating reset request | Local preview delivery works; hosted SMTP receipt is intentionally unverified |
| Workspace onboarding, selection, persistence, isolation | Working | IAB create flow, workspace QA, Stage F QA | Owner/admin/member boundaries and stale selection behavior pass |
| Dashboard metrics and project/task summaries | Working | IAB live data, project/task QA, visual QA, Stage F QA | Metrics derive from PostgreSQL-backed project/task responses |
| Dashboard recent activity | Working with Limitations | Static/source review and current screenshots | Task activity is implemented; the dashboard activity panel intentionally remains empty |
| Project list, search, create, edit, detail, archive | Working | IAB search/create/detail, project/task QA, Stage F QA | Management controls are owner/admin-only |
| Task list, filters, create, edit, assignment, due dates | Working | IAB create/edit, project/task QA, timezone suites, Stage F QA | Status-only PATCH preserves omitted description/priority under Zod 4 |
| Kanban movement, persistence, undo, retry | Working | IAB move, Kanban unit/browser QA, Stage F QA | Keyboard/touch selector is available; manual intra-column ordering is not implemented |
| Team roster, roles, invitations, revocation/acceptance | Working with Limitations | Collaboration QA and Stage F QA | Preview links work locally; real provider delivery is unverified |
| Comments, author controls, moderation, task activity | Working | IAB comment/activity, collaboration tests/QA, Stage F QA | Activity is task-scoped and limited to the most recent 50 events |
| Theme, navigation, dialogs/drawer, responsive layouts | Working | IAB theme/focus checks; 12-state visual QA; Stage F responsive captures | Dark/light, desktop/tablet/mobile/320 px checks pass |
| Loading, empty, error, permission, recovery states | Working | Unit/integration tests, visual QA, focused browser QA | Development preview controls are excluded from production builds |
| Global/advanced search, notifications, calendar | Intentionally Deferred | Source and UI notice review | Controls explicitly explain V1.1/later availability; no silent no-op |
| Templates, settings, help, profile/account preferences | Intentionally Deferred | Source and UI notice review | Visible controls return explanatory notices |
| Workspace ownership transfer/self-removal | Not Implemented | Stage E/F/G2 documentation and API review | Required before long-lived organization support |
| Real-time updates, attachments, advanced analytics/workflows, integrations | Intentionally Deferred | README and checkpoint review | Outside the current release |

No feature is classified **Broken** after the QA-harness correction.

## Functional and UX audit

The current-run in-app-browser journey created an isolated account, workspace, project, assigned high-priority task, Kanban status change, comment, and activity event. It also exercised project search, Team, theme switching, modal Escape dismissal/focus restoration, a deferred Calendar notice, logout, protected-route behavior, and password-recovery messaging. The isolated account and workspace were then deleted by exact identifier; no unrelated record was touched.

Visual inspection covered authentication, workspace onboarding, empty and populated dashboards, project detail, Kanban, task activity, and Team. The interface retained the approved dark-first Modern Professional direction, clear heading/action hierarchy, readable form labeling, consistent state feedback, and responsive navigation. The automated captures found:

- 12 development visual states with zero axe WCAG 2 A/AA, 2.1 AA, or 2.2 AA rule violations;
- zero horizontal overflow, out-of-bounds controls, or clipped text in those 12 states;
- seven full Stage F captures at 1440, 768, 390, and 320 px with zero axe violations, horizontal overflow, or out-of-bounds controls.

These are automated rule and layout checks, not a claim of full WCAG conformance. Manual keyboard evidence included dialog/drawer Escape behavior and focus restoration; the repository workflows also cover the Kanban status alternative to pointer drag.

## Security and data-integrity review

- Every protected API rechecks the server-side session and current session version.
- State-changing routes require the exact configured Origin and reject cross-site Fetch Metadata.
- Workspace/project/task/comment lookups enforce membership; inaccessible cross-workspace resources returned `404` in the full browser journey.
- Project management, invitation, role, removal, and comment-moderation policies were exercised for owner/admin/member roles.
- SQL request values are parameterized. The two dynamic update statements build column names only from fixed server-owned maps.
- Workspace creation, invitations/outbox, invitation acceptance, member removal/assignment cleanup, token replacement/consumption, password reset, and migrations use transactions where atomicity is required.
- Passwords use Argon2id. Invitation and account-lifecycle bearer tokens are high entropy, stored as hashes, expiring, and single-use.
- Password-reset request responses are non-enumerating; a reset increments the session version and invalidates old sessions.
- JSON input is limited to 64 KB; authentication/recovery endpoints are rate-limited; validation errors remain bounded JSON responses under Zod 4.
- Security headers checked in Stage F included `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and same-origin resource policy.
- The final database count matched the initial baseline: zero users, workspaces, memberships, projects, tasks, comments, invitations, activity events, auth tokens, outbox jobs, and sessions; five migration records remained.

## Corrections included

### Dependency security

- `body-parser`: 1.20.8 → 1.20.9 transitively through the existing Express 4.22.3 range.
- `zod`: 3.25.76 → 4.6.7.
- Separate create/default and default-free PATCH schemas prevent Zod 4 from injecting create defaults during partial task updates.
- Validation error formatting uses `z.flattenError` while preserving the public response shape.
- Focused regression tests protect status-only PATCH preservation and invalid-request details.

See `DEPENDENCY-SECURITY-CHECKPOINT.md` for advisory identifiers and migration evidence.

### Visual QA harness

- Default URL changed from the obsolete `http://127.0.0.1:4173/` production preview to the development server at `http://localhost:5173/`, where the intentional preview-state controls exist.
- Added deterministic project, task, and member route fixtures required by the current PostgreSQL-backed frontend architecture.
- Exact regression result: original command failed; corrected command passed 12 captured states.

## Verification matrix

| Check | Result |
| --- | --- |
| Frontend Vitest | 8 files, 37 tests passed |
| Backend Vitest | 8 files, 39 tests passed |
| Backend Vitest under UTC | 8 files, 39 tests passed |
| Backend Vitest under America/Los_Angeles | 8 files, 39 tests passed |
| Backend Vitest under Asia/Taipei | 8 files, 39 tests passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed; 1,948 modules transformed |
| Backend production build | Passed |
| Combined production build | Passed with `VITE_API_URL` empty for same-origin output |
| Production bundle scan | No localhost API URL, `Preview state`, or `Prototype controls` |
| Frontend dependency audit | 0 vulnerabilities |
| Backend dependency audit | 0 vulnerabilities |
| Migration replay | 0 applied, 5 already current |
| Concurrent PostgreSQL migration verifier | Passed; five migrations tracked |
| Live authentication verifier | Passed |
| Live readiness verifier | Passed |
| Authentication browser QA | Passed |
| Workspace browser QA | Passed |
| Projects/tasks browser QA | Passed |
| Kanban browser QA | Passed |
| Collaboration browser QA | Passed |
| Consolidated Stage F browser QA | Passed; 9 workflow/security groups |
| Visual QA | Passed; 12 captures, zero axe/layout findings |
| `git diff --check` | Passed |
| Temporary application records | 0; baseline restored |

The local development `.env` intentionally sets `VITE_API_URL=http://localhost:4000`. A same-origin production build must omit or explicitly clear that variable, as documented in the README and deployment runbook; the verified combined production build did so.

## Remaining risks and boundaries

- Live Render/Neon/Resend behavior, sender DNS, bounce handling, proxy-hop assumptions, TLS, monitoring, backups, and restore rehearsal remain hosted deployment gates.
- Rate limiting is process-local and supports only the planned single-instance portfolio service.
- Automated accessibility checks and keyboard smoke tests do not replace a full assistive-technology audit.
- No load, denial-of-service, penetration, external security, or production incident test was performed.
- Dependency audits are point-in-time evidence and must continue in CI and before releases.
- The early `PRODUCT.md` retains historical prototype statements about mock data; Stage C–G2 checkpoints, the README, and current source are the authoritative current state.

## Scope guard

No feature redesign, deployment, cloud resource creation, database reset, Git history rewrite, Figma operation, or new Stage G2 infrastructure work was performed. The next stage must wait for explicit approval.
