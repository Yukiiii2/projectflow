# ProjectFlow Stage G2 — Deployment Readiness Part 1 Checkpoint

**Date:** 2026-10-26

**Baseline:** `519a447bfbd7b9124b986d4caf9eada39addd27c` on synchronized `main`

**Status:** Part 1 locally verified; no deployment or provider changes performed

## Scope

This checkpoint covers only:

- production configuration and environment validation;
- Render-compatible Express and compiled Vite static serving;
- secure session cookies, proxy/HTTPS behavior, and security headers;
- safe database migrations for deployment;
- focused tests, complete regression suites, TypeScript checks, and production builds.

Email changes, monitoring setup, backup automation, cloud provisioning, DNS, deployment, and all later Stage G2 work were explicitly out of scope and were not started.

## Baseline assessment

The synchronized repository already contained the approved Stage G2 Part 1 implementation from the pre-reformat checkpoint. This pass reconciled that implementation with `STAGE-G1-DEPLOYMENT-PLAN.md`, `STAGE-G2-READINESS-CHECKPOINT.md`, the deployment and recovery runbooks, the current source, and current official Render documentation.

No missing in-scope production behavior was found, so no application source, package, migration, lockfile, or deployment configuration change was justified. The only tracked repository change in this pass is this checkpoint.

## Verified production behavior

### Configuration and environment validation

- Production startup requires an exact HTTPS `FRONTEND_ORIGIN`.
- Production `DATABASE_URL` must use PostgreSQL and include `sslmode=require`, `verify-ca`, or `verify-full`.
- `SESSION_SECRET` must be at least 32 characters and cannot use the documented placeholder.
- Production requires SMTP delivery, email verification, complete SMTP credentials, and a valid independent 32-byte base64 outbox key.
- Proxy hops, port, token lifetimes, Boolean flags, and log level are bounded or enumerated.
- Backend secrets remain server-only; the same-origin production frontend omits `VITE_API_URL`.

### Render-compatible single-service serving

- The root build compiles Vite into `dist/` and compiles the backend separately.
- The root start command launches the compiled Express backend.
- In production, Express resolves the root `dist/` directory from the compiled backend entry point.
- `/api/*` routes and the JSON API 404 run before static middleware and the SPA fallback.
- Client-side deep links return `index.html` with `Cache-Control: no-cache`.
- Hashed assets under `assets/` receive long-lived immutable caching.
- `render.yaml` uses the currently supported Node web-service fields, keeps automatic deploys off, uses `/api/health`, and declares secrets with `sync: false`.

### Cookies, proxy behavior, HTTPS, and headers

- Production trusts a bounded configured proxy-hop count.
- Insecure `GET` and `HEAD` requests redirect with status 308 to the configured public origin, never to a request-controlled host.
- Insecure state-changing requests fail closed.
- Exact-Origin validation and cross-site Fetch Metadata rejection protect state-changing requests.
- The production session cookie is `__Host-projectflow.sid` with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`, with no `Domain` attribute.
- Helmet supplies the production CSP, HSTS, frame denial, MIME-sniffing protection, and no-referrer policy.
- The focused production integration test verifies CSP, HSTS, deep-link serving, immutable asset caching, API precedence, HTTPS enforcement, and request IDs.

### Safe migrations

- Numbered SQL migrations are ordered lexically and tracked in `schema_migrations` with a SHA-256 checksum and timestamp.
- A PostgreSQL advisory lock serializes concurrent runners.
- Each pending migration runs in its own transaction and records its ledger row only after its SQL succeeds.
- A changed applied migration fails closed on checksum mismatch.
- Failure rolls back the current migration; advisory unlock and client release run during cleanup.
- The migration entry point is separate from application startup; the Render service does not run schema changes from every application instance.

## Verification results

| Check | Result |
| --- | --- |
| Focused backend readiness, migration, and application tests | 3 files, **26/26 passed** |
| Focused frontend API-base tests | 1 file, **2/2 passed** |
| Complete frontend suite | 8 files, **37/37 passed** |
| Complete backend suite | 8 files, **39/39 passed** |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Combined production build | Passed; Vite transformed **1,948 modules**, backend compiled |
| Production bundle scan | No `http://localhost:4000`, `Preview state`, or `Prototype controls` |
| Real PostgreSQL migration verifier | Passed; **5** tracked migrations, concurrent runners serialized |
| Repeat real PostgreSQL migration | **0 applied, 5 already current** |
| Frontend high-severity dependency audit | **0 vulnerabilities** |
| Backend high-severity dependency audit | **0 vulnerabilities** |

The production bundle was built with `VITE_API_URL` explicitly empty. Removing that shell override causes Vite to load the ignored local development `.env`, which correctly embeds the local API URL for development but is not the Render build condition. No secret value was printed or recorded.

The backend suite emits one structured `request_failed` error event while exercising its intentional generic-500 error path; all 39 tests pass.

## Files changed in Part 1

- `STAGE-G2-PART-1-CHECKPOINT.md`

No production code, SQL migration, package manifest, lockfile, environment file, CI workflow, or Render Blueprint was changed.

## Remaining hosted blockers

The following require a separately approved hosted release-candidate phase and cannot be proven by local tests alone:

1. Confirm Render's actual proxy chain matches `TRUST_PROXY_HOPS=1` and that the Node process cannot be reached around the proxy.
2. Confirm the public HTTPS origin delivers the expected redirect, CSP, HSTS, frame, MIME, referrer, cache, and request-ID headers.
3. Confirm the `__Host-projectflow.sid` cookie is accepted, persists across refresh, and is removed on logout through the real HTTPS origin.
4. Confirm the managed PostgreSQL connection uses the selected provider's pooled TLS endpoint and that the runtime and migration credentials have the intended privileges.
5. Run the protected migration command and application read/write smoke workflow against a disposable hosted database branch before any real release.

These are blockers to claiming a hosted production verification, not defects in the local Part 1 implementation.

## Stop boundary

Stage G2 Part 1 stops here. No Render, PostgreSQL provider, email provider, monitoring service, backup service, DNS record, secret, or deployment was created or changed. Email, monitoring, backups, and other deployment tasks remain untouched pending a separate request.
