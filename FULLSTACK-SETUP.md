# ProjectFlow — Full-stack local setup

The React/Vite frontend uses the Express API for authentication, workspace membership, projects, tasks, Kanban workflow updates, invitations, comments, and task activity. PostgreSQL stores users, server-side sessions, workspaces, memberships, invitations, projects, tasks, comments, activity events, and date-only due dates.

See `backend/README.md` for PostgreSQL, migration, and backend environment setup.

Run both processes:

```powershell
# Terminal 1
Set-Location C:\Users\EN\Documents\ProjectFlow-Design\prototype\backend
npm.cmd run dev

# Terminal 2
Set-Location C:\Users\EN\Documents\ProjectFlow-Design\prototype
npm.cmd run dev -- --host localhost --port 5173
```

Configuration:

- Frontend `VITE_API_URL`: defaults to `http://localhost:4000`.
- Backend `FRONTEND_ORIGIN`: must match the frontend browser origin, normally `http://localhost:5173`.
- Browser API requests use `credentials: 'include'` so the HttpOnly session cookie is sent.
- Database credentials and `SESSION_SECRET` stay exclusively in `backend/.env`.
- `INVITATION_DELIVERY=preview` returns a clearly labelled local acceptance link and does not send email.
- For real delivery, set `INVITATION_DELIVERY=smtp` and configure the SMTP values documented in `backend/.env.example`.

Open `http://localhost:5173`. Unauthenticated visits to private routes redirect to `/login`; successful sign-in or registration returns to the requested private route. New accounts continue to first-workspace onboarding. Existing accounts load only the workspaces returned for their session membership.

Run this from `prototype` while both servers and PostgreSQL are active:

```powershell
npm.cmd run project-task:qa
npm.cmd run kanban:qa
npm.cmd run collaboration:qa
npm.cmd run stage-f:qa
```

The workflows verify project/task and Kanban persistence, date-only due dates, dashboard statistics, invitations, member roles, assignments, comments, activity, cross-workspace isolation, session restoration, CSRF-origin enforcement, request limits, responsive layouts, accessibility, and cleanup against the local database. `stage-f:qa` composes these areas into one complete browser journey.

This remains a local portfolio application. Authentication endpoints have an in-memory throttle suitable for this single-process environment. Live SMTP verification, distributed throttling for multiple instances, email verification, password recovery, production TLS/proxy and frontend-header review, backups, monitoring, workspace ownership transfer, and an external security assessment are required before public deployment.
