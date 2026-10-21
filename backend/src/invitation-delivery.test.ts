import { afterEach, describe, expect, it } from 'vitest'
import { invitationDeliveryFromEnv, previewInvitationDelivery } from './invitation-delivery.js'

const originalEnvironment = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnvironment }
})

describe('invitation delivery configuration', () => {
  it('returns an explicit preview without claiming an email was sent', async () => {
    const result = await previewInvitationDelivery().send({
      recipient: 'invitee@example.com',
      inviterName: 'Maya Chen',
      workspaceName: 'Northstar Studio',
      role: 'member',
      expiresAt: '2026-10-27T00:00:00.000Z',
      acceptUrl: 'http://localhost:5173/invite/example-token',
    })

    expect(result).toEqual({
      status: 'preview',
      preview_url: 'http://localhost:5173/invite/example-token',
    })
  })

  it('rejects preview delivery in production', () => {
    process.env.INVITATION_DELIVERY = 'preview'
    expect(() => invitationDeliveryFromEnv(true)).toThrow('not allowed in production')
  })

  it('rejects incomplete SMTP configuration before startup', () => {
    process.env.INVITATION_DELIVERY = 'smtp'
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    delete process.env.INVITATION_FROM

    expect(() => invitationDeliveryFromEnv(false)).toThrow('required for SMTP delivery')
  })
})
