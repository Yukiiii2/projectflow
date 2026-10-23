import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export type AuthTokenPurpose = 'email_verification' | 'password_reset'

export function hashAuthToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export interface IssuedAuthToken { token: string; expiresAt: Date }

export async function issueAuthTokenInTransaction(client: PoolClient, userId: string, purpose: AuthTokenPurpose, ttlMinutes: number) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  const user = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
  if (!user.rows[0]) throw new Error('Cannot issue an authentication token for a missing user')
  await client.query('UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [userId, purpose])
  await client.query('INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES ($1,$2,$3,$4)', [userId, purpose, hashAuthToken(token), expiresAt])
  return { token, expiresAt }
}

export async function issueAuthToken(
  db: Pool,
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMinutes: number,
  beforeCommit?: (client: PoolClient, issued: IssuedAuthToken) => Promise<void>,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const issued = await issueAuthTokenInTransaction(client, userId, purpose, ttlMinutes)
      await beforeCommit?.(client, issued)
      await client.query('COMMIT')
      return issued
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { /* preserve the source error */ }
      if (attempt === 0 && typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') continue
      throw error
    } finally {
      client.release()
    }
  }
  throw new Error('Unable to issue authentication token')
}

export async function authTokenOwner(client: PoolClient, token: string, purpose: AuthTokenPurpose) {
  const result = await client.query<{ user_id: string }>(
    'SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now()',
    [hashAuthToken(token), purpose],
  )
  return result.rows[0]
}

export async function activeAuthToken(client: PoolClient, token: string, purpose: AuthTokenPurpose) {
  const result = await client.query<{ id: string; user_id: string }>(
    'SELECT id,user_id FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
    [hashAuthToken(token), purpose],
  )
  return result.rows[0]
}
