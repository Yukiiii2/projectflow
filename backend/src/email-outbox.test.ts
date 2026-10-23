import { describe, expect, it, vi } from 'vitest'
import { processNextOutboxMessage, queuedInvitationDelivery } from './email-outbox.js'

describe('production email outbox', () => {
  const key = Buffer.alloc(32, 7)

  it('queues delivery without awaiting the SMTP transport', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const delivery = queuedInvitationDelivery({ query } as never, key)

    const result = await delivery.sendPasswordReset({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-22T12:00:00.000Z',
      resetUrl: 'https://projectflow.example/reset-password?token=secret',
    })

    expect(result).toEqual({ status: 'queued' })
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO email_outbox')
    expect(String(query.mock.calls[0]?.[1]?.[1])).not.toContain('reset-password')
  })

  it('claims and delivers one queued message before marking it sent', async () => {
    const message = { recipient: 'maya@example.com', name: 'Maya', expiresAt: '2026-10-22T12:00:00.000Z', resetUrl: 'https://projectflow.example/reset-password?token=secret' }
    const enqueueQuery = vi.fn().mockResolvedValue({ rows: [] })
    await queuedInvitationDelivery({ query: enqueueQuery } as never, key).sendPasswordReset(message)
    const encrypted = JSON.parse(String(enqueueQuery.mock.calls[0]?.[1]?.[1]))
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-id', kind: 'password_reset', payload: encrypted, attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
    const sendPasswordReset = vi.fn().mockResolvedValue({ status: 'sent' })
    const delivered = await processNextOutboxMessage(
      { query } as never,
      { mode: 'smtp', send: vi.fn(), sendVerification: vi.fn(), sendPasswordReset } as never,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      key,
    )

    expect(delivered).toBe(true)
    expect(sendPasswordReset).toHaveBeenCalledWith(message)
    expect(query.mock.calls[2]?.[0]).toContain('DELETE FROM email_outbox')
  })

  it('purges expired or exhausted jobs before attempting delivery', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    const delivered = await processNextOutboxMessage(
      { query } as never,
      { mode: 'smtp', send: vi.fn(), sendVerification: vi.fn(), sendPasswordReset: vi.fn() } as never,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      key,
    )

    expect(delivered).toBe(false)
    expect(query.mock.calls[0]?.[0]).toContain('expires_at <= now() OR attempts >= 5')
  })
})
