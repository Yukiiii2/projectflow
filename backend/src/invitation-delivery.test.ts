import { afterEach, describe, expect, it, vi } from 'vitest'
import { invitationDeliveryFromEnv, previewInvitationDelivery } from './invitation-delivery.js'

const { createTransport } = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}))

vi.mock('nodemailer', () => ({ default: { createTransport } }))

const originalEnvironment = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnvironment }
  createTransport.mockClear()
})

function configureSmtp(port: string) {
  process.env.INVITATION_DELIVERY = 'smtp'
  process.env.SMTP_HOST = 'smtp.resend.com'
  process.env.SMTP_PORT = port
  process.env.SMTP_USER = 'resend'
  process.env.SMTP_PASSWORD = 'test-resend-secret'
  process.env.INVITATION_FROM = 'ProjectFlow <invites@projectflow.example>'
}

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

  it.each([
    ['465', true, false],
    ['2465', true, false],
    ['587', false, true],
    ['2587', false, true],
  ])('configures Resend port %s with secure=%s and requireTLS=%s', (port, secure, requireTLS) => {
    configureSmtp(port)

    invitationDeliveryFromEnv(true)

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.resend.com',
      port: Number(port),
      secure,
      requireTLS,
    }))
  })

  it.each(['25', '2525', '0', '70000', 'not-a-port'])('rejects unsafe production SMTP port %s', (port) => {
    configureSmtp(port)

    expect(() => invitationDeliveryFromEnv(true)).toThrow('Production SMTP_PORT')
    expect(createTransport).not.toHaveBeenCalled()
  })
})
