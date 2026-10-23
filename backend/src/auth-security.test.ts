import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import session from 'express-session'
import { DataType, newDb } from 'pg-mem'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { issueAuthToken } from './auth-tokens.js'
import type { InvitationDelivery, VerificationMessage, PasswordResetMessage } from './invitation-delivery.js'

const origin = 'http://localhost:5173'
const password = 'correct horse battery staple'
const pools: Pool[] = []

class CapturingDelivery implements InvitationDelivery {
  mode = 'preview' as const
  verifications: VerificationMessage[] = []
  resets: PasswordResetMessage[] = []
  async send(message: Parameters<InvitationDelivery['send']>[0]) { return { status: 'sent' as const } }
  async sendVerification(message: VerificationMessage) {
    this.verifications.push(message)
    return { status: 'preview' as const, preview_url: message.verifyUrl }
  }
  async sendPasswordReset(message: PasswordResetMessage) {
    this.resets.push(message)
    return { status: 'preview' as const, preview_url: message.resetUrl }
  }
}

async function context(requireEmailVerification = true, emailOutbox?: Parameters<typeof createApp>[0]['emailOutbox']) {
  const memory = newDb({ autoCreateForeignKeyIndices: true })
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: randomUUID })
  const files = await Promise.all(['001_init.sql', '002_collaboration.sql', '003_account_security.sql'].map((name) => readFile(fileURLToPath(new URL(`../sql/${name}`, import.meta.url)), 'utf8')))
  memory.public.none(files.join('\n').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''))
  memory.public.none('CREATE UNIQUE INDEX idx_auth_tokens_one_active ON auth_tokens(user_id, purpose) WHERE consumed_at IS NULL')
  const adapter = memory.adapters.createPg()
  const pool = new adapter.Pool() as unknown as Pool
  pools.push(pool)
  const delivery = new CapturingDelivery()
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    invitationDelivery: delivery,
    emailOutbox,
    config: {
      frontendOrigin: origin,
      sessionSecret: 'test-session-secret-at-least-32-characters',
      production: false,
      requireEmailVerification,
      verificationTtlMinutes: 60,
      passwordResetTtlMinutes: 30,
    },
  })
  return { app, pool, delivery }
}

function tokenFrom(url: string) {
  return new URL(url).searchParams.get('token')!
}

afterEach(async () => { await Promise.all(pools.splice(0).map((pool) => pool.end())) })

describe('account verification and recovery', () => {
  it('stores only a hash of the verification token and unlocks protected APIs once', async () => {
    const { app, pool, delivery } = await context()
    const agent = request.agent(app)
    const registration = await agent.post('/api/auth/register').set('Origin', origin).send({ name: 'Maya Chen', email: 'maya@example.com', password }).expect(201)
    expect(registration.body.user.email_verified).toBe(false)
    expect(delivery.verifications).toHaveLength(1)
    const token = tokenFrom(delivery.verifications[0]!.verifyUrl)
    const stored = await pool.query<{ token_hash: string }>('SELECT token_hash FROM auth_tokens WHERE purpose=$1', ['email_verification'])
    expect(stored.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.token_hash).not.toBe(token)

    await agent.get('/api/workspaces').expect(403, { error: 'Email verification required', code: 'EMAIL_VERIFICATION_REQUIRED' })
    await agent.post('/api/auth/email-verification/confirm').set('Origin', origin).send({ token }).expect(200)
    await agent.get('/api/workspaces').expect(200)
    await agent.post('/api/auth/email-verification/confirm').set('Origin', origin).send({ token }).expect(400, { error: 'Verification link is invalid or expired' })
  })

  it('returns the same reset-request response for known and unknown email addresses', async () => {
    const { app, delivery } = await context(false)
    await request(app).post('/api/auth/register').set('Origin', origin).send({ name: 'Maya Chen', email: 'maya@example.com', password }).expect(201)

    const known = await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email: 'maya@example.com' }).expect(202)
    const unknown = await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email: 'missing@example.com' }).expect(202)
    expect(known.body).toEqual(unknown.body)
    expect(known.body).toEqual({ message: 'If an account matches that email, a reset link has been sent.' })
    expect(delivery.resets).toHaveLength(1)
  })

  it('resets the password once and invalidates sessions issued with the previous version', async () => {
    const { app, delivery } = await context(false)
    const agent = request.agent(app)
    await agent.post('/api/auth/register').set('Origin', origin).send({ name: 'Maya Chen', email: 'maya@example.com', password }).expect(201)
    await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email: 'maya@example.com' }).expect(202)
    const token = tokenFrom(delivery.resets[0]!.resetUrl)

    await request(app).post('/api/auth/password-reset/confirm').set('Origin', origin).send({ token, password: 'a new correct horse battery staple' }).expect(204)
    await agent.get('/api/workspaces').expect(401, { error: 'Sign in required' })
    await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'maya@example.com', password }).expect(401)
    await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'maya@example.com', password: 'a new correct horse battery staple' }).expect(200)
    await request(app).post('/api/auth/password-reset/confirm').set('Origin', origin).send({ token, password: 'another correct horse battery staple' }).expect(400, { error: 'Password reset link is invalid or expired' })
  })

  it('serializes replacement tokens so only one remains active per purpose', async () => {
    const { pool } = await context(false)
    const user = await pool.query<{ id: string }>('INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', ['Concurrent User', 'concurrent@example.com', 'unused'])
    await Promise.all([
      issueAuthToken(pool, user.rows[0]!.id, 'password_reset', 30),
      issueAuthToken(pool, user.rows[0]!.id, 'password_reset', 30),
    ])
    const active = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [user.rows[0]!.id])
    expect(active.rows[0]?.count).toBe('1')
  })

})
