import { describe, expect, it } from 'vitest'
import { CapturingEmailDelivery, PROJECTFLOW_TEST_EMAIL_CAPTURE } from './email-capture.test-support.js'

describe('isolated test email capture', () => {
  it('captures each transactional message without returning a bearer URL', async () => {
    const delivery = new CapturingEmailDelivery()
    const expiresAt = '2026-10-28T00:00:00.000Z'

    const invitation = await delivery.send({
      recipient: 'member@example.test',
      inviterName: 'Owner',
      workspaceName: 'QA Workspace',
      role: 'member',
      expiresAt,
      acceptUrl: 'http://127.0.0.1/invite/invitation-secret',
    })
    const verification = await delivery.sendVerification({
      recipient: 'owner@example.test',
      name: 'Owner',
      expiresAt,
      verifyUrl: 'http://127.0.0.1/verify-email?token=verification-secret',
    })
    const reset = await delivery.sendPasswordReset({
      recipient: 'owner@example.test',
      name: 'Owner',
      expiresAt,
      resetUrl: 'http://127.0.0.1/reset-password?token=reset-secret',
    })

    expect(invitation).toEqual({ status: 'sent' })
    expect(verification).toEqual({ status: 'sent' })
    expect(reset).toEqual({ status: 'sent' })
    expect(JSON.stringify([invitation, verification, reset])).not.toContain('secret')
    expect(delivery.take('invitation', 'member@example.test')).toMatchObject({ acceptUrl: expect.stringContaining('invitation-secret') })
    expect(delivery.take('email_verification', 'owner@example.test')).toMatchObject({ verifyUrl: expect.stringContaining('verification-secret') })
    expect(delivery.take('password_reset', 'owner@example.test')).toMatchObject({ resetUrl: expect.stringContaining('reset-secret') })
  })

  it('consumes a captured message once and clears any remaining token-bearing state', async () => {
    const delivery = new CapturingEmailDelivery()
    await delivery.sendVerification({
      recipient: 'owner@example.test',
      name: 'Owner',
      expiresAt: '2026-10-28T00:00:00.000Z',
      verifyUrl: 'http://127.0.0.1/verify-email?token=one-time-secret',
    })

    expect(delivery.take('email_verification', 'owner@example.test')).toBeDefined()
    expect(delivery.take('email_verification', 'owner@example.test')).toBeUndefined()

    await delivery.sendPasswordReset({
      recipient: 'owner@example.test',
      name: 'Owner',
      expiresAt: '2026-10-28T00:00:00.000Z',
      resetUrl: 'http://127.0.0.1/reset-password?token=clear-secret',
    })
    delivery.clear()
    expect(delivery.take('password_reset', 'owner@example.test')).toBeUndefined()
    expect(PROJECTFLOW_TEST_EMAIL_CAPTURE).toBe('PROJECTFLOW_TEST_EMAIL_CAPTURE')
  })
})
