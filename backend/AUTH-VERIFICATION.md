# Live authentication verification

Verified on 2026-10-20 against the local PostgreSQL database and the Express API at `http://localhost:4000`.

## Verified behavior

- The health endpoint confirmed database-backed API availability.
- Unauthenticated profile and workspace requests returned `401`.
- Unknown accounts and incorrect passwords returned `401` without creating cookies.
- Registration returned `201` and normalized the test identity correctly.
- The database stored an Argon2id hash that verified against the generated password; neither authentication response exposed the plaintext password or hash.
- Registration and login created server-side rows in the PostgreSQL `session` table.
- The session cookie used the expected name, `HttpOnly`, `SameSite=Lax`, root path, and expiry attributes. Development mode correctly omitted `Secure`; production mode requires HTTPS and enables it.
- A registered or logged-in session remained valid across repeated profile requests and authorized the protected workspace endpoint.
- Logout returned `204`, expired the browser cookie, removed the PostgreSQL session, and made the previous cookie unauthorized.
- A new login generated a different session ID after logout.

The verifier creates a unique account under the reserved `.invalid` domain and removes that exact account and its session rows in a `finally` cleanup block. It does not update or delete existing users.

## Repeat the verification

With the API running and the local `.env` configured:

```powershell
npm.cmd run verify:auth:live
```

The verifier intentionally does not print generated passwords, cookies, session IDs, hashes, connection strings, or session secrets.
