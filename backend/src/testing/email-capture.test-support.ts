import type {
  InvitationDelivery,
  InvitationMessage,
  PasswordResetMessage,
  VerificationMessage,
} from '../invitation-delivery.js'

export const PROJECTFLOW_TEST_EMAIL_CAPTURE = 'PROJECTFLOW_TEST_EMAIL_CAPTURE'

export type CapturedEmailKind = 'invitation' | 'email_verification' | 'password_reset'
export type CapturedEmailMessage = InvitationMessage | VerificationMessage | PasswordResetMessage

interface CapturedEmail {
  kind: CapturedEmailKind
  message: CapturedEmailMessage
}

export class CapturingEmailDelivery implements InvitationDelivery {
  readonly mode = 'preview' as const
  #messages: CapturedEmail[] = []

  async send(message: InvitationMessage) {
    this.#messages.push({ kind: 'invitation', message })
    return { status: 'sent' as const }
  }

  async sendVerification(message: VerificationMessage) {
    this.#messages.push({ kind: 'email_verification', message })
    return { status: 'sent' as const }
  }

  async sendPasswordReset(message: PasswordResetMessage) {
    this.#messages.push({ kind: 'password_reset', message })
    return { status: 'sent' as const }
  }

  take(kind: 'invitation', recipient: string): InvitationMessage | undefined
  take(kind: 'email_verification', recipient: string): VerificationMessage | undefined
  take(kind: 'password_reset', recipient: string): PasswordResetMessage | undefined
  take(kind: CapturedEmailKind, recipient: string): CapturedEmailMessage | undefined {
    const index = this.#messages.findIndex((captured) => captured.kind === kind && captured.message.recipient === recipient)
    if (index < 0) return undefined
    return this.#messages.splice(index, 1)[0]?.message
  }

  clear() {
    this.#messages.length = 0
  }
}
