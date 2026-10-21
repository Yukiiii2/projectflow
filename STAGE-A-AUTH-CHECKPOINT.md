# ProjectFlow Stage A — Frontend Authentication Checkpoint

## Status

Stage A is complete and ready for review. Frontend integration stops at authentication; workspace, project, task, and comment API integration has not started.

## Completed behavior

- `/login` and `/register` use the approved Modern Professional design system in dark and light themes.
- `/` is protected and redirects unauthenticated visitors to sign in.
- Successful registration and login return users to the requested private route.
- `GET /api/auth/me` restores the authenticated user after refresh.
- Browser focus and visibility restoration revalidate an active session and explain expiration before redirecting to sign in.
- All requests use `credentials: 'include'` for the HttpOnly PostgreSQL-backed session cookie.
- Logout destroys the backend session, clears frontend auth state, and returns to sign in.
- The desktop profile and mobile drawer show the authenticated user and both provide logout.
- Form validation runs after blur or submit, preserves recoverable input, and covers required fields, email format, password length, confirmation, duplicate registration, invalid credentials, network errors, and loading states.
- Database credentials and session secrets remain backend-only.

## Verified API workflow

The automated browser workflow used a unique `.invalid` test identity and verified:

1. Private-route redirect and unauthorized access.
2. Invalid login without a session.
3. Registration through the rendered form.
4. Argon2id storage in PostgreSQL.
5. Dashboard access and session restoration after reload.
6. Logout and protected-route rejection.
7. Invalid-password rejection followed by successful login.
8. Final logout and deletion of the generated user and session rows.

No existing user records were updated or deleted.

## Verification evidence

| Check | Result |
| --- | --- |
| Frontend unit and interaction tests | 14 passed |
| TypeScript | Passed |
| Production build | Passed |
| Frontend production dependency audit | 0 vulnerabilities |
| Real browser authentication workflow | Passed |
| Desktop auth layouts | 1440px dark and light passed |
| Mobile auth layouts | 390px and 320px passed |
| Auth axe WCAG-tagged violations | 0 |
| Dashboard visual states | 12 passed after auth integration |
| Temporary authentication accounts remaining | 0 |

Reports:

- `artifacts/auth-qa-report.json`
- `artifacts/visual-qa-report.json`

## Configuration

- Frontend: `VITE_API_URL=http://localhost:4000`, or rely on the same default.
- Backend: `FRONTEND_ORIGIN=http://localhost:5173` for the normal Vite development URL.
- Backend and PostgreSQL must be running before real authentication can complete.

## Remaining limitations

- Newly registered users enter the existing mock Northstar Studio dashboard because workspace onboarding and workspace API integration are later stages.
- Password recovery, email verification, invitations, and persistent “remember me” choices are not implemented by the current backend contract.
- A failed network request during logout clears frontend state but cannot directly remove the HttpOnly server cookie; the sign-in screen reports that the API did not confirm logout.
- Production hosting must provide HTTPS, an exact production `FRONTEND_ORIGIN`, secure cookies, and SPA route fallback.
- Rate limiting and production authentication hardening remain required before public deployment.

## Review gate

Review the sign-in and registration experience, real session behavior, responsive layouts, and the transition into the preserved mock dashboard before authorizing workspace or project API integration.
