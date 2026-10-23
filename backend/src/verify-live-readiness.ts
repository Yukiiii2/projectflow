import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import session from 'express-session'
import request from 'supertest'
import { createApp } from './app.js'
import { createDatabasePool } from './db.js'
import { processNextOutboxMessage, queuedInvitationDelivery } from './email-outbox.js'
import type { InvitationDelivery, PasswordResetMessage, VerificationMessage } from './invitation-delivery.js'
import { createLogger } from './logger.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')

class CaptureDelivery implements InvitationDelivery {
  mode = 'preview' as const
  verification?: VerificationMessage
  reset?: PasswordResetMessage
  async send() { return { status: 'sent' as const } }
  async sendVerification(message: VerificationMessage) { this.verification = message; return { status: 'preview' as const, preview_url: message.verifyUrl } }
  async sendPasswordReset(message: PasswordResetMessage) { this.reset = message; return { status: 'preview' as const, preview_url: message.resetUrl } }
}

function token(url: string | undefined) {
  if (!url) throw new Error('Expected a captured delivery URL')
  const value = new URL(url).searchParams.get('token')
  if (!value) throw new Error('Expected a delivery token')
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const db = createDatabasePool(process.env.DATABASE_URL)
const delivery = new CaptureDelivery()
const origin = 'http://localhost:5173'
const email = `stage-g2-${randomUUID()}@example.test`
const atomicRegistrationEmail = `stage-g2-atomic-registration-${randomUUID()}@example.test`
const atomicInvitationEmail = `stage-g2-atomic-invitation-${randomUUID()}@example.test`
const originalPassword = 'stage g2 original password'
const replacementPassword = 'stage g2 replacement password'
const outboxKey = Buffer.alloc(32, 7)
let userId: string | undefined
let outboxId: string | undefined

try {
  const app = createApp({
    db,
    sessionStore: new session.MemoryStore(),
    invitationDelivery: delivery,
    config: {
      frontendOrigin: origin,
      sessionSecret: 'stage-g2-live-verification-secret-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      verificationTtlMinutes: 30,
      passwordResetTtlMinutes: 15,
    },
  })
  const agent = request.agent(app)
  const registration = await agent.post('/api/auth/register').set('Origin', origin).send({ name: 'Stage G2 QA', email, password: originalPassword })
  assert(registration.status === 201, 'Registration failed')
  userId = registration.body.user.id as string

  const stored = await db.query<{ token_hash: string }>('SELECT token_hash FROM auth_tokens WHERE user_id=$1', [userId])
  assert(stored.rows.length === 1 && /^[a-f0-9]{64}$/.test(stored.rows[0]!.token_hash), 'Verification token was not stored as a SHA-256 hash')
  assert((await agent.get('/api/workspaces')).status === 403, 'Unverified account was not gated')
  assert((await agent.post('/api/auth/email-verification/confirm').set('Origin', origin).send({ token: token(delivery.verification?.verifyUrl) })).status === 200, 'Verification failed')
  assert((await agent.get('/api/workspaces')).status === 200, 'Verified account remained gated')

  assert((await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email })).status === 202, 'Reset request failed')
  assert((await request(app).post('/api/auth/password-reset/confirm').set('Origin', origin).send({ token: token(delivery.reset?.resetUrl), password: replacementPassword })).status === 204, 'Password reset failed')
  assert((await agent.get('/api/workspaces')).status === 401, 'Old session remained valid after password reset')
  assert((await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: originalPassword })).status === 401, 'Old password remained valid')
  assert((await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: replacementPassword })).status === 200, 'Replacement password did not authenticate')

  delivery.reset = undefined
  assert((await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email })).status === 202, 'Concurrent reset setup failed')
  const concurrentToken = token((delivery.reset as unknown as PasswordResetMessage | undefined)?.resetUrl)
  const [confirmation, resend] = await Promise.all([
    request(app).post('/api/auth/password-reset/confirm').set('Origin', origin).send({ token: concurrentToken, password: 'stage g2 concurrent replacement password' }),
    request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email }),
  ])
  assert([204, 400].includes(confirmation.status), 'Concurrent confirmation failed outside the expected race outcomes')
  assert(resend.status === 202, 'Concurrent resend failed')
  const activeTokens = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [userId])
  assert(Number(activeTokens.rows[0]?.count) <= 1, 'Concurrent confirmation and resend left multiple active tokens')

  delivery.reset = undefined
  const queued = await queuedInvitationDelivery(db, outboxKey).sendPasswordReset({ recipient: email, name: 'Stage G2 QA', expiresAt: new Date(Date.now() + 60_000).toISOString(), resetUrl: `${origin}/reset-password?token=outbox-verification-token` })
  assert(queued.status === 'queued', 'Production delivery was not queued')
  const storedOutbox = (await db.query<{ id: string; payload: string }>('SELECT id,payload::text AS payload FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]
  outboxId = storedOutbox?.id
  assert(!storedOutbox?.payload.includes('outbox-verification-token'), 'Queued bearer URL was stored without encryption')
  assert(await processNextOutboxMessage(db, delivery, createLogger({ level: 'error' }), outboxKey), 'Queued email was not claimed')
  const deliveredReset = delivery.reset as unknown as PasswordResetMessage | undefined
  assert(deliveredReset?.recipient === email, 'Queued email was not delivered to the transport')
  const outbox = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM email_outbox WHERE id=$1', [outboxId])
  assert(outbox.rows[0]?.count === '0', 'Delivered outbox message retained its bearer URL')

  const atomicRegistrationApp = createApp({
    db,
    sessionStore: new session.MemoryStore(),
    invitationDelivery: delivery,
    emailOutbox: { async enqueue() { throw new Error('simulated queue failure') } },
    config: { frontendOrigin: origin, sessionSecret: 'stage-g2-atomic-registration-secret-32-characters', production: false },
  })
  assert((await request(atomicRegistrationApp).post('/api/auth/register').set('Origin', origin).send({ name: 'Atomic Registration', email: atomicRegistrationEmail, password: originalPassword })).status === 500, 'Simulated registration queue failure did not fail safely')
  const rolledBackUsers = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM users WHERE email=$1', [atomicRegistrationEmail])
  assert(rolledBackUsers.rows[0]?.count === '0', 'Registration source record committed without its email job')

  const atomicInvitationApp = createApp({
    db,
    sessionStore: new session.MemoryStore(),
    invitationDelivery: delivery,
    emailOutbox: { async enqueue(_client, kind) { if (kind === 'invitation') throw new Error('simulated queue failure'); return { status: 'queued' as const } } },
    config: { frontendOrigin: origin, sessionSecret: 'stage-g2-atomic-invitation-secret-at-least-32', production: false },
  })
  const atomicAgent = request.agent(atomicInvitationApp)
  const atomicUser = await atomicAgent.post('/api/auth/register').set('Origin', origin).send({ name: 'Atomic Invitation', email: atomicInvitationEmail, password: originalPassword })
  assert(atomicUser.status === 201, 'Atomic invitation test account registration failed')
  const atomicWorkspace = await atomicAgent.post('/api/workspaces').set('Origin', origin).send({ name: 'Atomic Invitation Workspace' })
  assert(atomicWorkspace.status === 201, 'Atomic invitation test workspace creation failed')
  const failedInvitation = await atomicAgent.post(`/api/workspaces/${atomicWorkspace.body.workspace.id}/invitations`).set('Origin', origin).send({ email: 'atomic-recipient@example.test', role: 'member' })
  assert(failedInvitation.status === 500, 'Simulated invitation queue failure did not fail safely')
  const rolledBackInvitations = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM workspace_invitations WHERE workspace_id=$1', [atomicWorkspace.body.workspace.id])
  assert(rolledBackInvitations.rows[0]?.count === '0', 'Invitation source record committed without its email job')

  console.log('Stage G2 live readiness verification passed: hashed tokens, verification gate, password reset, session invalidation, lock-order concurrency, encrypted delivery, and atomic source/outbox transactions.')
} finally {
  if (outboxId) await db.query('DELETE FROM email_outbox WHERE id=$1', [outboxId])
  if (userId) await db.query('DELETE FROM users WHERE id=$1', [userId])
  const atomicUsers = await db.query<{ id: string }>('SELECT id FROM users WHERE email=ANY($1::text[])', [[atomicRegistrationEmail, atomicInvitationEmail]])
  for (const user of atomicUsers.rows) await db.query('DELETE FROM workspaces WHERE created_by=$1', [user.id])
  await db.query('DELETE FROM users WHERE email=ANY($1::text[])', [[atomicRegistrationEmail, atomicInvitationEmail]])
  const remaining = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM users WHERE email=$1', [email])
  await db.end()
  if (remaining.rows[0]?.count !== '0') throw new Error('Temporary Stage G2 account cleanup failed')
}
