# ProjectFlow — Final Portfolio Browser QA Checkpoint

**Date:** 2026-10-28
**Scope:** Local production bundle, isolated loopback PostgreSQL schema, Microsoft Edge/Playwright browser automation
**Production impact:** None. No Render settings, Neon data, Resend settings, migrations, commits, pushes, or deployments were changed.

## Outcome

ProjectFlow passed the final local portfolio QA. The public landing page remained visually coherent at all six requested widths, the auth-aware root route behaved correctly, and a complete private-demo journey used the real Express APIs and PostgreSQL data model. The final run reported no unexpected browser console errors, page errors, failed network requests, serious/critical axe violations, credential-like response data, horizontal overflow, or cleanup residue.

No application defect required a source/UI fix during this pass. The only corrections were to the new QA harness itself: precise accessible locators, state-based waits instead of transient toast text, the correct `activity_events` verifier table, and the expected public landing destination after an expired root-route demo session.

## Browser walkthrough

| Step | Check | Health | Evidence |
| ---: | --- | --- | --- |
| 1 | Unauthenticated `/`, navigation anchors, sign-in and browser return | Pass | Landing page restored after sign-in navigation; feature/how-it-works anchors scrolled correctly |
| 2 | Landing layout at 1920, 1440, 1024, 768, 390, and 320 px | Pass | All widths had zero horizontal overflow, no overlap, no broken media, and a consistent visual hierarchy |
| 3 | Keyboard focus, compact menu, Escape close, reduced motion | Pass | Visible focus treatment; compact navigation restored focus; reduced-motion styles removed animation/scroll motion |
| 4 | Demo disabled state | Pass | CTA remained on the landing page and displayed “The live demo is temporarily unavailable.” |
| 5 | Demo entry and seeded workspace | Pass | Private identity/workspace created; dashboard, three projects, twelve seeded tasks, members, comments, and task activity loaded |
| 6 | Project/task collaboration | Pass | Created a task, changed title/status/assignee, added/edited/deleted a comment, and verified the resulting activity history |
| 7 | Kanban and dashboard consistency | Pass | Moved the created task to Done, refreshed, retained status, and observed dashboard completion move from 4/12 to 5/13 |
| 8 | Authentication lifecycle | Pass | Authenticated `/` returned the dashboard; logout returned sign-in; forced expiry denied APIs and returned root to the public landing page |
| 9 | Isolation and privilege boundaries | Pass | Cross-demo and real-workspace reads returned nondisclosing 404s; workspace creation, invitations, member mutation, recovery/account controls, and privileged UI remained blocked |
| 10 | Abuse/resource controls | Pass | The sixth demo creation attempt from the same address returned 429; project/task/comment quota enforcement remains covered by backend regression tests |
| 11 | Cleanup | Pass | Every disposable demo instance was deleted; the isolated schema was dropped; no QA Edge/Node process remained |

## Visual observations and screenshots

All screenshots were captured from the final production bundle and inspected after the run. The intentionally visible “Skip to main content” control in landing captures is keyboard-focus evidence, not a layout defect.

| View | Observation | Local evidence |
| --- | --- | --- |
| 1920 px desktop | Balanced two-column hero, restrained maximum content width, crisp previews, aligned bento grid and footer | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-1920.png` |
| 1440 px desktop | Full navigation and preview composition remained aligned with no clipping | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-1440.png` |
| 1024 px laptop/tablet | Hero and preview remained legible; feature grid retained useful density | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-1024.png` |
| 768 px tablet | Compact menu activated; hero/preview stacked cleanly; feature grid remained two columns | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-768.png` |
| 390 px mobile | Single-column CTAs/cards, vertical how-it-works sequence, and footer links remained readable | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-390.png` |
| 320 px mobile | No horizontal overflow or truncated controls at the minimum requested width | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/landing-320.png` |
| Demo unavailable | Clear inline error without navigation loss or security bypass | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/07-demo-disabled.png` |
| Demo dashboard | Realistic seeded data and persistent temporary-workspace banner | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/08-demo-dashboard.png` |
| Projects | Three seeded projects with responsive progress summaries | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/09-projects.png` |
| Comment editing | Real task side panel, editable comment, clear ownership/actions | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/10-task-comment-edited.png` |
| Task activity | Create, status, add/edit/delete-comment events shown chronologically | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/11-task-activity.png` |
| Kanban persistence | New task remained in Done after refresh with the selected assignee | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/12-kanban-persisted.png` |
| Auth-aware root | `/` restored the authenticated dashboard and updated 5/13 completion metrics | `.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/13-authenticated-root.png` |

## Security and data handling

- Both browser sessions received different demo identities, `demo_instance_id` values, and workspace IDs.
- A synthetic ordinary account/workspace existed only inside the disposable schema; a demo read returned 404.
- Demo APIs returned 403 for workspace creation, invitation listing/creation, and member-role changes.
- Expired sessions returned 401 and triggered opportunistic record cleanup.
- Browser response inspection found no password, session, token, authorization header, bearer credential, connection-string credential, or email-capture payload.
- Production still defaults to `DEMO_MODE_ENABLED=false` in both `backend/.env.example` and `render.yaml`.
- Final database cleanup query returned `disposableQaSchemas: 0`; production Neon was never selected or modified.

## Verification evidence

| Verification | Result |
| --- | --- |
| Final portfolio browser QA | Pass; all 15 grouped checks, 13 inspected screenshots |
| Local performance sample | DOMContentLoaded 49 ms; load 49 ms; first contentful paint 76 ms; 854 KiB encoded resources |
| Existing demo browser QA | Pass; desktop/mobile, persistence, isolation, expiry/logout, and critical accessibility |
| Frontend tests | 46/46 passed across 9 files |
| Backend tests | 90/90 passed across 14 files |
| Frontend TypeScript | Pass |
| Backend TypeScript | Pass |
| Production + Render build verification | Pass; frontend and `backend/dist/server.js` aligned with the start command |
| Production bundle safety scan | Pass; no localhost API URL, development-only control, or secret marker |
| Root dependency audit | 0 vulnerabilities |
| Backend dependency audit | 0 vulnerabilities |
| `git diff --check` | Pass |
| Staged changes | None |

Reusable command:

```powershell
$env:PROJECTFLOW_LOCAL_ENV_PATH='C:\path\to\private\backend\.env'
npm --prefix backend run verify:portfolio:browser
```

The harness rejects non-loopback database URLs, creates and drops an isolated schema, starts both disabled/enabled local app instances, and closes every browser/server resource in `finally` cleanup.

## Remaining limitations

- The performance figures are loopback measurements from one local Edge run, not hosted Render cold-start or field Core Web Vitals.
- Expiry was verified by safely advancing the disposable database record instead of waiting 30 real minutes; the same expiry path and cleanup behavior executed.
- The dashboard's “Recent activity” card remains an existing empty-state view even though task-level activity is real and persisted. Task activity, Kanban state, and dashboard completion metrics were verified; adding a workspace-wide feed would be separate feature work.
- The minified application JavaScript is 506.02 kB (152.40 kB gzip) and triggers Vite's advisory 500 kB chunk warning. Local FCP remained fast, but route-level code splitting can be evaluated later if hosted metrics justify it.
- Resend's unverified-domain delivery restriction is unchanged. This does not affect the isolated demo; normal registration still requires real email verification.
- Only local Microsoft Edge was exercised in this pass. A short live Render smoke test remains necessary after an approved deployment.

## Production readiness assessment

The reviewed working tree is **ready for human review and a controlled deployment sequence**, but it is not yet deployed and production demo mode must remain disabled until the database and hosted smoke checks are complete.

Exact prerequisites:

1. Review this checkpoint, the screenshots, and the complete uncommitted diff; confirm no generated evidence or private environment file will be staged.
2. Keep Render `DEMO_MODE_ENABLED=false` for the first deployment.
3. Create/confirm a Neon recovery point, then—only with explicit approval—run the six migrations through the direct `MIGRATION_DATABASE_URL`; migration 006 is additive and must target the intended production database.
4. Confirm the pooled runtime role has only the required DML on the new demo tables/columns and still has no schema, migration-ledger, role, database, or ownership privileges.
5. Commit and push the reviewed source/configuration/documentation, wait for GitHub Actions to pass, and allow Render to deploy without changing secrets.
6. Verify live `/api/health`, landing routing, sign-in, existing account/session behavior, and ordinary data access before enabling the demo.
7. Set `DEMO_MODE_ENABLED=true` only after those checks; then test two private sessions, cross-workspace 404 behavior, quotas, expiry/logout cleanup, and structured logs on Render Free.
8. Disable the switch immediately if active-instance capacity, abuse controls, or cleanup behavior differs from the local evidence. No schema rollback is required to disable the feature.

## Stop condition

QA is complete. No commit, push, migration, Render change, Resend change, or deployment was performed.
