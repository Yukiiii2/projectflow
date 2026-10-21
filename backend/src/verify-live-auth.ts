import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL missing');

const email = `auth-verification-${randomUUID()}@example.invalid`;
const password = `${randomBytes(24).toString('base64url')}Aa1!`;
const pool = new pg.Pool({ connectionString: databaseUrl });
let userId: string | undefined;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function apiRequest(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
) {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.Origin = origin;
  return fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function responseCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie');
  check(setCookie, 'Expected a session cookie');
  const separator = setCookie.indexOf(';');
  const cookie = separator === -1 ? setCookie : setCookie.slice(0, separator);
  check(cookie.startsWith('projectflow.sid='), 'Unexpected session cookie name');
  return { cookie, setCookie };
}

async function cleanup() {
  const found = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [email]);
  const cleanupUserId = userId ?? found.rows[0]?.id;
  if (cleanupUserId) {
    await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [cleanupUserId]);
    await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [cleanupUserId, email]);
  }
}

try {
  const health = await apiRequest('/api/health');
  check(health.status === 200, 'Health endpoint did not return 200');

  const unauthorizedMe = await apiRequest('/api/auth/me');
  check(unauthorizedMe.status === 401, 'Unauthenticated profile request was not rejected');
  const unauthorizedWorkspaces = await apiRequest('/api/workspaces');
  check(unauthorizedWorkspaces.status === 401, 'Unauthenticated workspace request was not rejected');

  const unknownLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  check(unknownLogin.status === 401, 'Unknown account login was not rejected');
  check(!unknownLogin.headers.get('set-cookie'), 'Rejected login created a session cookie');

  const registration = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: { name: 'Authentication Verification', email, password },
  });
  check(registration.status === 201, 'Registration did not return 201');
  const registrationBody = await registration.json() as { user?: { id?: string; email?: string } };
  check(registrationBody.user?.id, 'Registration response omitted the user ID');
  check(registrationBody.user.email === email, 'Registration response returned an unexpected email');
  check(!JSON.stringify(registrationBody).includes(password), 'Registration response exposed the password');
  userId = registrationBody.user.id;

  const registeredCookie = responseCookie(registration);
  check(/;\s*HttpOnly/i.test(registeredCookie.setCookie), 'Session cookie is missing HttpOnly');
  check(/;\s*SameSite=Lax/i.test(registeredCookie.setCookie), 'Session cookie is missing SameSite=Lax');
  check(/;\s*Path=\//i.test(registeredCookie.setCookie), 'Session cookie path is incorrect');
  check(/;\s*Expires=/i.test(registeredCookie.setCookie), 'Session cookie is missing an expiry');
  if (process.env.NODE_ENV === 'production') {
    check(/;\s*Secure/i.test(registeredCookie.setCookie), 'Production session cookie is missing Secure');
  } else {
    check(!/;\s*Secure/i.test(registeredCookie.setCookie), 'Development session cookie unexpectedly uses Secure');
  }

  const stored = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1 AND email=$2', [userId, email]);
  const hash = stored.rows[0]?.password_hash;
  check(typeof hash === 'string' && hash.startsWith('$argon2id$'), 'Stored password is not an Argon2id hash');
  check(hash !== password, 'Stored password matches the plaintext password');
  check(await argon2.verify(hash, password), 'Stored password hash did not verify');

  const registrationSessions = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "session" WHERE sess->>'userId'=$1`, [userId]);
  check(registrationSessions.rows[0]?.count === 1, 'Registration session was not persisted in PostgreSQL');

  const firstProfile = await apiRequest('/api/auth/me', { cookie: registeredCookie.cookie });
  check(firstProfile.status === 200, 'Registered session did not authorize the profile endpoint');
  const secondProfile = await apiRequest('/api/auth/me', { cookie: registeredCookie.cookie });
  check(secondProfile.status === 200, 'Session did not persist across requests');
  const protectedWorkspaces = await apiRequest('/api/workspaces', { cookie: registeredCookie.cookie });
  check(protectedWorkspaces.status === 200, 'Registered session did not authorize a protected endpoint');

  const firstLogout = await apiRequest('/api/auth/logout', { method: 'POST', cookie: registeredCookie.cookie });
  check(firstLogout.status === 204, 'Logout did not return 204');
  const clearedCookie = firstLogout.headers.get('set-cookie');
  check(typeof clearedCookie === 'string' && clearedCookie.startsWith('projectflow.sid='), 'Logout did not clear the session cookie');
  check(/Expires=Thu, 01 Jan 1970/i.test(clearedCookie), 'Logout cookie did not expire immediately');
  const afterLogout = await apiRequest('/api/auth/me', { cookie: registeredCookie.cookie });
  check(afterLogout.status === 401, 'Destroyed session remained authorized');

  const badPassword = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { email, password: `${randomBytes(24).toString('base64url')}Bb2!` },
  });
  check(badPassword.status === 401, 'Invalid password was not rejected');
  check(!badPassword.headers.get('set-cookie'), 'Invalid password created a session cookie');

  const login = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  check(login.status === 200, 'Valid login did not return 200');
  const loginBody = await login.json() as { user?: { id?: string }; password_hash?: unknown };
  check(loginBody.user?.id === userId, 'Valid login returned an unexpected user');
  check(loginBody.password_hash === undefined, 'Login response exposed the password hash');
  check(!JSON.stringify(loginBody).includes(password), 'Login response exposed the password');
  const loginCookie = responseCookie(login);
  check(loginCookie.cookie !== registeredCookie.cookie, 'Login reused the destroyed session ID');

  const loginSession = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "session" WHERE sess->>'userId'=$1`, [userId]);
  check(loginSession.rows[0]?.count === 1, 'Login session was not persisted in PostgreSQL');
  const loggedInProfile = await apiRequest('/api/auth/me', { cookie: loginCookie.cookie });
  check(loggedInProfile.status === 200, 'Login session did not authorize the profile endpoint');

  const finalLogout = await apiRequest('/api/auth/logout', { method: 'POST', cookie: loginCookie.cookie });
  check(finalLogout.status === 204, 'Final logout did not return 204');
  const remainingSessions = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "session" WHERE sess->>'userId'=$1`, [userId]);
  check(remainingSessions.rows[0]?.count === 0, 'Logout left an active server-side session');

  console.log('Live authentication verification passed:');
  console.log('- registration and Argon2id storage');
  console.log('- PostgreSQL session persistence and protected routes');
  console.log('- invalid credentials and unauthorized access');
  console.log('- cookie security attributes and logout invalidation');
} finally {
  await cleanup();
  await pool.end();
}
