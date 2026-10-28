import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  InvitationDelivery,
  InvitationDeliveryResult,
  InvitationMessage,
  PasswordResetMessage,
  VerificationMessage,
} from './invitation-delivery.js'
import { deliveryErrorLogFields, deliveryErrorSummary } from './invitation-delivery.js'
import type { Logger } from './logger.js'

export type OutboxKind = 'invitation' | 'email_verification' | 'password_reset'
export type OutboxMessage = InvitationMessage | VerificationMessage | PasswordResetMessage
type Queryable = Pick<Pool | PoolClient, 'query'>

interface EncryptedPayload {
  v: 1
  iv: string
  tag: string
  ciphertext: string
}

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error('EMAIL_OUTBOX_KEY must decode to exactly 32 bytes')
}

function encryptPayload(key: Buffer, payload: OutboxMessage): EncryptedPayload {
  assertKey(key)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

function decryptPayload(key: Buffer, payload: EncryptedPayload | string): OutboxMessage {
  assertKey(key)
  const envelope = typeof payload === 'string' ? JSON.parse(payload) as EncryptedPayload : payload
  if (envelope.v !== 1) throw new Error('Unsupported email outbox payload version')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as OutboxMessage
}

export interface EmailOutbox {
  enqueue(client: Queryable, kind: OutboxKind, payload: OutboxMessage): Promise<InvitationDeliveryResult>
}

export function createEmailOutbox(key: Buffer): EmailOutbox {
  assertKey(key)
  return {
    async enqueue(client, kind, payload) {
      const encrypted = encryptPayload(key, payload)
      await client.query('INSERT INTO email_outbox(kind,payload,expires_at) VALUES ($1,$2::jsonb,$3)', [kind, JSON.stringify(encrypted), payload.expiresAt])
      return { status: 'queued' }
    },
  }
}

export function queuedInvitationDelivery(db: Pool, key: Buffer): InvitationDelivery {
  const outbox = createEmailOutbox(key)
  return {
    mode: 'smtp',
    send(message) { return outbox.enqueue(db, 'invitation', message) },
    sendVerification(message) { return outbox.enqueue(db, 'email_verification', message) },
    sendPasswordReset(message) { return outbox.enqueue(db, 'password_reset', message) },
  }
}

interface OutboxRow {
  id: string
  kind: OutboxKind
  payload: EncryptedPayload | string
  attempts: number
}

export async function processNextOutboxMessage(db: Pool, delivery: InvitationDelivery, logger: Logger, key: Buffer) {
  await db.query('DELETE FROM email_outbox WHERE expires_at <= now() OR attempts >= 5')
  const claimed = await db.query<OutboxRow>(`WITH next_message AS (
    SELECT id FROM email_outbox
    WHERE available_at <= now() AND expires_at > now() AND attempts < 5
      AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE email_outbox AS message
  SET locked_at=now(), attempts=attempts+1
  FROM next_message
  WHERE message.id=next_message.id
  RETURNING message.id,message.kind,message.payload,message.attempts`)
  const row = claimed.rows[0]
  if (!row) return false

  try {
    const payload = decryptPayload(key, row.payload)
    const options = { idempotencyKey: `projectflow/outbox/${row.id}` }
    if (row.kind === 'invitation') await delivery.send(payload as InvitationMessage, options)
    else if (row.kind === 'email_verification') await delivery.sendVerification(payload as VerificationMessage, options)
    else if (row.kind === 'password_reset') await delivery.sendPasswordReset(payload as PasswordResetMessage, options)
    else throw new Error('Unsupported email outbox kind')
    await db.query('DELETE FROM email_outbox WHERE id=$1', [row.id])
    logger.info('email_outbox_delivered', { messageId: row.id, kind: row.kind })
  } catch (error) {
    const errorFields = deliveryErrorLogFields(error)
    if (row.attempts >= 5) {
      await db.query('DELETE FROM email_outbox WHERE id=$1', [row.id])
      logger.error('email_outbox_delivery_abandoned', { messageId: row.id, kind: row.kind, ...errorFields, attempts: row.attempts })
      return true
    }
    const retryMinutes = Math.min(60, 2 ** Math.min(row.attempts, 6))
    await db.query(`UPDATE email_outbox
      SET locked_at=NULL, available_at=now()+($2 * interval '1 minute'), last_error=$3
      WHERE id=$1`, [row.id, retryMinutes, deliveryErrorSummary(error)])
    logger.warn('email_outbox_delivery_failed', { messageId: row.id, kind: row.kind, ...errorFields, attempts: row.attempts, retryMinutes })
  }
  return true
}

export function startEmailOutboxWorker(db: Pool, delivery: InvitationDelivery, logger: Logger, key: Buffer, intervalMs = 5_000) {
  let stopped = false
  let running: Promise<void> | undefined
  const run = () => {
    if (stopped || running) return
    running = (async () => {
      try {
        for (let count = 0; count < 20 && await processNextOutboxMessage(db, delivery, logger, key); count += 1) {
          if (stopped) break
        }
      } catch (error) {
        logger.error('email_outbox_worker_failed', { errorName: error instanceof Error ? error.name : 'UnknownError' })
      }
    })().finally(() => { running = undefined })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref()
  run()
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
