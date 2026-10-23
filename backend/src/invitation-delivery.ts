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

export interface InvitationDelivery {
  mode: 'preview' | 'smtp'
  send(message: InvitationMessage): Promise<InvitationDeliveryResult>
  sendVerification(message: VerificationMessage): Promise<InvitationDeliveryResult>
  sendPasswordReset(message: PasswordResetMessage): Promise<InvitationDeliveryResult>
}

export function previewInvitationDelivery(): InvitationDelivery {
  return {
    mode: 'preview',
    async send(message) { return { status: 'preview', preview_url: message.acceptUrl } },
    async sendVerification(message) { return { status: 'preview', preview_url: message.verifyUrl } },
    async sendPasswordReset(message) { return { status: 'preview', preview_url: message.resetUrl } },
  }
}

export function invitationDeliveryFromEnv(production: boolean): InvitationDelivery {
  const mode = process.env.INVITATION_DELIVERY ?? (production ? 'smtp' : 'preview')
  if (mode === 'preview') {
    if (production) throw new Error('INVITATION_DELIVERY=preview is not allowed in production')
    return previewInvitationDelivery()
  }
  if (mode !== 'smtp') throw new Error('INVITATION_DELIVERY must be preview or smtp')

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.INVITATION_FROM
  if (!host || !Number.isInteger(port) || !user || !pass || !from) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and INVITATION_FROM are required for SMTP delivery')
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
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
