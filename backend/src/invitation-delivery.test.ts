import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliveryErrorLogFields, invitationDeliveryFromEnv, previewInvitationDelivery } from './invitation-delivery.js'

const { createTransport } = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}))

vi.mock('nodemailer', () => ({ default: { createTransport } }))

const originalEnvironment = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnvironment }
  createTransport.mockClear()
  vi.unstubAllGlobals()
})

function configureSmtp(port: string) {
  process.env.INVITATION_DELIVERY = 'smtp'
  process.env.SMTP_HOST = 'smtp.resend.com'
  process.env.SMTP_PORT = port
  process.env.SMTP_USER = 'resend'
  process.env.SMTP_PASSWORD = 'test-resend-secret'
  process.env.INVITATION_FROM = 'ProjectFlow <invites@projectflow.example>'
}

function configureResendApi() {
  process.env.INVITATION_DELIVERY = 'resend'
  process.env.RESEND_API_KEY = 'test-resend-api-key'
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

  it('sends password recovery through the Resend HTTPS API with a stable idempotency key', async () => {
    configureResendApi()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const delivery = invitationDeliveryFromEnv(true)
    const result = await delivery.sendPasswordReset({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-27T00:00:00.000Z',
      resetUrl: 'https://projectflow.example/reset-password?token=secret',
    }, { idempotencyKey: 'projectflow/outbox/job-id' })

    expect(result).toEqual({ status: 'sent' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(request).toMatchObject({ method: 'POST' })
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer test-resend-api-key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'projectflow/outbox/job-id',
      'User-Agent': 'ProjectFlow/1.0',
    })
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: 'ProjectFlow <invites@projectflow.example>',
      to: ['maya@example.com'],
      subject: 'Reset your ProjectFlow password',
    })
  })

  it('turns a Resend API rejection into a secret-safe delivery failure', async () => {
    configureResendApi()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'rate_limit_exceeded',
      statusCode: 429,
      message: 'provider detail containing test-resend-api-key',
    }), { status: 429 })))

    const delivery = invitationDeliveryFromEnv(true)
    const failure = await delivery.sendVerification({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-27T00:00:00.000Z',
      verifyUrl: 'https://projectflow.example/verify-email?token=secret',
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      name: 'ResendApiError',
      message: 'Resend API request failed with status 429',
      status: 429,
      providerCode: 'rate_limit_exceeded',
      providerReason: 'rate_limited',
    })
    expect(deliveryErrorLogFields(failure)).toEqual({
      errorName: 'ResendApiError',
      providerStatus: 429,
      providerCode: 'rate_limit_exceeded',
      providerReason: 'rate_limited',
    })
    expect(String(failure)).not.toContain('test-resend-api-key')
    expect(String(failure)).not.toContain('provider detail')
  })

  it.each([
    [
      'the Resend testing sender is restricted to the account owner',
      'You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain.',
      'testing_recipient_restricted',
    ],
    [
      'the configured sender domain has not been verified',
      'The example.test domain is not verified. Please add and verify your domain before sending.',
      'sender_domain_unverified',
    ],
  ])('classifies a 403 when %s without retaining provider text', async (_label, message, providerReason) => {
    configureResendApi()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'validation_error',
      statusCode: 403,
      message,
    }), { status: 403 })))

    const failure = await invitationDeliveryFromEnv(true).sendVerification({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-27T00:00:00.000Z',
      verifyUrl: 'https://projectflow.example/verify-email?token=secret',
    }).catch((error: unknown) => error)

    expect(deliveryErrorLogFields(failure)).toEqual({
      errorName: 'ResendApiError',
      providerStatus: 403,
      providerCode: 'validation_error',
      providerReason,
    })
    expect(JSON.stringify(failure)).not.toContain('example.test')
    expect(JSON.stringify(failure)).not.toContain('maya@example.com')
  })

  it('turns a Resend network failure into a provider-neutral delivery failure', async () => {
    configureResendApi()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket failure with test-resend-api-key')))

    const failure = await invitationDeliveryFromEnv(true).sendVerification({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-27T00:00:00.000Z',
      verifyUrl: 'https://projectflow.example/verify-email?token=secret',
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ name: 'ResendApiError', message: 'Resend API request failed' })
    expect(String(failure)).not.toContain('test-resend-api-key')
  })

  it('rejects a successful Resend response that has no message id', async () => {
    configureResendApi()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(invitationDeliveryFromEnv(true).sendVerification({
      recipient: 'maya@example.com',
      name: 'Maya',
      expiresAt: '2026-10-27T00:00:00.000Z',
      verifyUrl: 'https://projectflow.example/verify-email?token=secret',
    })).rejects.toThrow('Resend API returned an invalid response')
  })

  it('rejects incomplete Resend API configuration before startup', () => {
    process.env.INVITATION_DELIVERY = 'resend'
    delete process.env.RESEND_API_KEY
    process.env.INVITATION_FROM = 'ProjectFlow <invites@projectflow.example>'

    expect(() => invitationDeliveryFromEnv(true)).toThrow('RESEND_API_KEY and INVITATION_FROM are required')
  })
})
