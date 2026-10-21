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
  status: 'preview' | 'sent'
  preview_url?: string
}

export interface InvitationDelivery {
  mode: 'preview' | 'smtp'
  send(message: InvitationMessage): Promise<InvitationDeliveryResult>
}

export function previewInvitationDelivery(): InvitationDelivery {
  return {
    mode: 'preview',
    async send(message) { return { status: 'preview', preview_url: message.acceptUrl } },
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
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, disableFileAccess: true, disableUrlAccess: true })
  return {
    mode: 'smtp',
    async send(message) {
      const result = await transport.sendMail({
        from,
        to: message.recipient,
        subject: `${headerText(message.inviterName)} invited you to ${headerText(message.workspaceName)}`,
        text: `You were invited to join ${message.workspaceName} as ${message.role}. Accept before ${message.expiresAt}: ${message.acceptUrl}`,
        html: `<p><strong>${escapeHtml(message.inviterName)}</strong> invited you to <strong>${escapeHtml(message.workspaceName)}</strong> as ${message.role}.</p><p><a href="${escapeHtml(message.acceptUrl)}">Accept invitation</a></p><p>This invitation expires ${escapeHtml(message.expiresAt)}.</p>`,
      })
      if (!result.accepted.map(String).some((recipient) => recipient.toLowerCase() === message.recipient.toLowerCase())) {
        throw new Error('SMTP server did not accept the invitation recipient')
      }
      return { status: 'sent' }
    },
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

function headerText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}
