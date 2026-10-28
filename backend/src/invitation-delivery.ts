import nodemailer from 'nodemailer'

export interface InvitationMessage {
  recipient: string
  inviterName: string
  workspaceName: string
  role: 'admin' | 'member'
  expiresAt: string
  acceptUrl: string
}

export interface InvitationDeliveryResult {
  status: 'preview' | 'queued' | 'sent'
  preview_url?: string
}

export interface VerificationMessage {
  recipient: string
  name: string
  expiresAt: string
  verifyUrl: string
}

export interface PasswordResetMessage {
  recipient: string
  name: string
  expiresAt: string
  resetUrl: string
}

export interface DeliveryOptions {
  idempotencyKey?: string
}

export interface InvitationDelivery {
  mode: 'disabled' | 'preview' | 'resend' | 'smtp'
  send(message: InvitationMessage, options?: DeliveryOptions): Promise<InvitationDeliveryResult>
  sendVerification(message: VerificationMessage, options?: DeliveryOptions): Promise<InvitationDeliveryResult>
  sendPasswordReset(message: PasswordResetMessage, options?: DeliveryOptions): Promise<InvitationDeliveryResult>
}

export function disabledInvitationDelivery(): InvitationDelivery {
  const unavailable = async (): Promise<InvitationDeliveryResult> => {
    throw new Error('Email delivery is disabled in portfolio mode')
  }
  return {
    mode: 'disabled',
    send: unavailable,
    sendVerification: unavailable,
    sendPasswordReset: unavailable,
  }
}

export function previewInvitationDelivery(): InvitationDelivery {
  return {
    mode: 'preview',
    async send(message) { return { status: 'preview', preview_url: message.acceptUrl } },
    async sendVerification(message) { return { status: 'preview', preview_url: message.verifyUrl } },
    async sendPasswordReset(message) { return { status: 'preview', preview_url: message.resetUrl } },
  }
}

function smtpTransportSecurity(port: number, production: boolean) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Production SMTP_PORT must be a valid secure SMTP port')
  }
  if (port === 465 || port === 2465) return { secure: true, requireTLS: false }
  if (port === 587 || port === 2587) return { secure: false, requireTLS: true }
  if (production) throw new Error('Production SMTP_PORT must use Resend SMTPS or STARTTLS')
  return { secure: false, requireTLS: false }
}

interface ResendApiErrorOptions extends ErrorOptions {
  status?: number
  providerCode?: string
  providerReason?: string
}

export class ResendApiError extends Error {
  override name = 'ResendApiError'

  readonly status?: number
  readonly providerCode?: string
  readonly providerReason?: string

  constructor(message: string, options: ResendApiErrorOptions = {}) {
    super(message, options)
    this.status = options.status
    this.providerCode = options.providerCode
    this.providerReason = options.providerReason
  }
}

function providerCode(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/i.test(value) ? value : undefined
}

function providerReason(status: number, message: unknown) {
  const detail = typeof message === 'string' ? message : ''
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'api_key_invalid'
  if (status !== 403) return undefined
  if (/only send testing emails to your own email address/i.test(detail)
    || (/resend\.dev/i.test(detail) && /(testing|own email)/i.test(detail))) {
    return 'testing_recipient_restricted'
  }
  if (/(domain|sender)/i.test(detail) && /(not verified|verify (?:a |your )?domain)/i.test(detail)) {
    return 'sender_domain_unverified'
  }
  if (/api key/i.test(detail) && /(permission|restricted|access|invalid)/i.test(detail)) {
    return 'api_key_permission_denied'
  }
  return 'forbidden'
}

async function resendRejection(response: Response) {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const error = body && typeof body === 'object' ? body as { name?: unknown; message?: unknown } : undefined
  return new ResendApiError(`Resend API request failed with status ${response.status}`, {
    status: response.status,
    providerCode: providerCode(error?.name),
    providerReason: providerReason(response.status, error?.message),
  })
}

export function deliveryErrorLogFields(error: unknown) {
  const fields: {
    errorName: string
    providerStatus?: number
    providerCode?: string
    providerReason?: string
  } = { errorName: error instanceof Error ? error.name : 'UnknownError' }
  if (error instanceof ResendApiError) {
    if (error.status !== undefined) fields.providerStatus = error.status
    if (error.providerCode !== undefined) fields.providerCode = error.providerCode
    if (error.providerReason !== undefined) fields.providerReason = error.providerReason
  }
  return fields
}

export function deliveryErrorSummary(error: unknown) {
  const fields = deliveryErrorLogFields(error)
  return [fields.errorName, fields.providerStatus, fields.providerCode, fields.providerReason]
    .filter((value) => value !== undefined)
    .join(':')
}

function resendApiDelivery(apiKey: string, from: string): InvitationDelivery {
  async function deliver(recipient: string, subject: string, text: string, html: string, options?: DeliveryOptions) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ProjectFlow/1.0',
    }
    if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({ from, to: [recipient], subject: headerText(subject), text, html }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new ResendApiError('Resend API request failed', { cause: error })
    }
    if (!response.ok) throw await resendRejection(response)

    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      throw new ResendApiError('Resend API returned an invalid response', { cause: error })
    }
    if (!result || typeof result !== 'object' || typeof (result as { id?: unknown }).id !== 'string' || !(result as { id: string }).id) {
      throw new ResendApiError('Resend API returned an invalid response')
    }
    return { status: 'sent' as const }
  }

  return {
    mode: 'resend',
    async send(message, options) {
      return deliver(
        message.recipient,
        `${message.inviterName} invited you to ${message.workspaceName}`,
        `You were invited to join ${message.workspaceName} as ${message.role}. Accept before ${message.expiresAt}: ${message.acceptUrl}`,
        `<p><strong>${escapeHtml(message.inviterName)}</strong> invited you to <strong>${escapeHtml(message.workspaceName)}</strong> as ${message.role}.</p><p><a href="${escapeHtml(message.acceptUrl)}">Accept invitation</a></p><p>This invitation expires ${escapeHtml(message.expiresAt)}.</p>`,
        options,
      )
    },
    async sendVerification(message, options) {
      return deliver(
        message.recipient,
        'Verify your ProjectFlow email',
        `Hello ${message.name}. Verify your email before ${message.expiresAt}: ${message.verifyUrl}`,
        `<p>Hello ${escapeHtml(message.name)}.</p><p><a href="${escapeHtml(message.verifyUrl)}">Verify your ProjectFlow email</a></p><p>This link expires ${escapeHtml(message.expiresAt)}.</p>`,
        options,
      )
    },
    async sendPasswordReset(message, options) {
      return deliver(
        message.recipient,
        'Reset your ProjectFlow password',
        `Hello ${message.name}. Reset your password before ${message.expiresAt}: ${message.resetUrl}`,
        `<p>Hello ${escapeHtml(message.name)}.</p><p><a href="${escapeHtml(message.resetUrl)}">Reset your ProjectFlow password</a></p><p>This link expires ${escapeHtml(message.expiresAt)}. If you did not request this, you can ignore this email.</p>`,
        options,
      )
    },
  }
}

export function invitationDeliveryFromEnv(production: boolean): InvitationDelivery {
  const mode = process.env.INVITATION_DELIVERY ?? (production ? 'resend' : 'preview')
  if (mode === 'preview') {
    if (production) throw new Error('INVITATION_DELIVERY=preview is not allowed in production')
    return previewInvitationDelivery()
  }
  if (mode === 'resend') {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.INVITATION_FROM
    if (!apiKey || !from) throw new Error('RESEND_API_KEY and INVITATION_FROM are required for Resend API delivery')
    return resendApiDelivery(apiKey, from)
  }
  if (mode !== 'smtp') throw new Error('INVITATION_DELIVERY must be preview, resend, or smtp')

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.INVITATION_FROM
  if (!host || !user || !pass || !from) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and INVITATION_FROM are required for SMTP delivery')
  }
  const transportSecurity = smtpTransportSecurity(port, production)
  const transport = nodemailer.createTransport({
    host,
    port,
    ...transportSecurity,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  async function deliver(recipient: string, subject: string, text: string, html: string) {
    const result = await transport.sendMail({ from, to: recipient, subject: headerText(subject), text, html })
    if (!result.accepted.map(String).some((accepted) => accepted.toLowerCase() === recipient.toLowerCase())) {
      throw new Error('SMTP server did not accept the recipient')
    }
    return { status: 'sent' as const }
  }
  return {
    mode: 'smtp',
    async send(message) {
      return deliver(
        message.recipient,
        `${message.inviterName} invited you to ${message.workspaceName}`,
        `You were invited to join ${message.workspaceName} as ${message.role}. Accept before ${message.expiresAt}: ${message.acceptUrl}`,
        `<p><strong>${escapeHtml(message.inviterName)}</strong> invited you to <strong>${escapeHtml(message.workspaceName)}</strong> as ${message.role}.</p><p><a href="${escapeHtml(message.acceptUrl)}">Accept invitation</a></p><p>This invitation expires ${escapeHtml(message.expiresAt)}.</p>`,
      )
    },
    async sendVerification(message) {
      return deliver(
        message.recipient,
        'Verify your ProjectFlow email',
        `Hello ${message.name}. Verify your email before ${message.expiresAt}: ${message.verifyUrl}`,
        `<p>Hello ${escapeHtml(message.name)}.</p><p><a href="${escapeHtml(message.verifyUrl)}">Verify your ProjectFlow email</a></p><p>This link expires ${escapeHtml(message.expiresAt)}.</p>`,
      )
    },
    async sendPasswordReset(message) {
      return deliver(
        message.recipient,
        'Reset your ProjectFlow password',
        `Hello ${message.name}. Reset your password before ${message.expiresAt}: ${message.resetUrl}`,
        `<p>Hello ${escapeHtml(message.name)}.</p><p><a href="${escapeHtml(message.resetUrl)}">Reset your ProjectFlow password</a></p><p>This link expires ${escapeHtml(message.expiresAt)}. If you did not request this, you can ignore this email.</p>`,
      )
    },
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

function headerText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}
