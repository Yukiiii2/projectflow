export interface ServerConfig {
  production: boolean
  port: number
  databaseUrl: string
  sessionSecret: string
  frontendOrigin: string
  invitationTtlHours: number
  verificationTtlMinutes: number
  passwordResetTtlMinutes: number
  requireEmailVerification: boolean
  trustProxyHops: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  emailOutboxKey?: Buffer
}

function isPlaceholder(value: string | undefined) {
  return !value || /^(change_me|replace_|placeholder)/i.test(value)
}

function usesResendTestingDomain(value: string) {
  const mailbox = value.trim().match(/<?[^<>\s@]+@([^<>\s]+)>?$/)
  return mailbox?.[1]?.toLowerCase() === 'resend.dev'
}

function integer(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function boolean(value: string | undefined, fallback: boolean, name: string) {
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function exactOrigin(value: string, production: boolean) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('FRONTEND_ORIGIN must be a valid origin') }
  if (url.origin !== value || url.username || url.password) throw new Error('FRONTEND_ORIGIN must be an exact origin without a path')
  if (production && url.protocol !== 'https:') throw new Error('Production FRONTEND_ORIGIN must use HTTPS')
  return value
}

function databaseUrl(value: string, production: boolean) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL')
  if (production && !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
    throw new Error('Production DATABASE_URL must include sslmode=require or stronger')
  }
  if (production && isPlaceholder(decodeURIComponent(url.password))) throw new Error('Production DATABASE_URL must not use a placeholder password')
  return value
}

export function loadServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const production = environment.NODE_ENV === 'production'
  const secret = environment.SESSION_SECRET
  const rawDatabaseUrl = environment.DATABASE_URL
  if (!secret) throw new Error('SESSION_SECRET missing')
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL missing')
  if (production && secret === 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS') throw new Error('Production SESSION_SECRET must not use the example placeholder')

  const requireEmailVerification = boolean(environment.REQUIRE_EMAIL_VERIFICATION, production, 'REQUIRE_EMAIL_VERIFICATION')
  if (production && !requireEmailVerification) throw new Error('Production requires email verification')
  if (production) {
    if (!['resend', 'smtp'].includes(environment.INVITATION_DELIVERY ?? '')) {
      throw new Error('Production INVITATION_DELIVERY must be set to resend or smtp')
    }
    if (environment.INVITATION_DELIVERY === 'resend') {
      if (!environment.RESEND_API_KEY || !environment.INVITATION_FROM) throw new Error('Production Resend API configuration is incomplete')
      if (isPlaceholder(environment.RESEND_API_KEY)) throw new Error('Production RESEND_API_KEY must not use a placeholder')
      if (usesResendTestingDomain(environment.INVITATION_FROM)) {
        throw new Error('Production INVITATION_FROM must use a verified custom domain; resend.dev is testing-only')
      }
    } else {
      const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'INVITATION_FROM'] as const
      if (required.some((name) => !environment[name])) throw new Error('Production SMTP configuration is incomplete')
      if (isPlaceholder(environment.SMTP_PASSWORD)) throw new Error('Production SMTP_PASSWORD must not use a placeholder')
    }
    if (!environment.EMAIL_OUTBOX_KEY || isPlaceholder(environment.EMAIL_OUTBOX_KEY)) throw new Error('Production EMAIL_OUTBOX_KEY is required')
  }

  let emailOutboxKey: Buffer | undefined
  if (environment.EMAIL_OUTBOX_KEY) {
    emailOutboxKey = Buffer.from(environment.EMAIL_OUTBOX_KEY, 'base64')
    if (emailOutboxKey.length !== 32 || emailOutboxKey.toString('base64') !== environment.EMAIL_OUTBOX_KEY) {
      throw new Error('EMAIL_OUTBOX_KEY must be a canonical base64 value encoding exactly 32 bytes')
    }
  }

  const logLevel = environment.LOG_LEVEL ?? (production ? 'info' : 'debug')
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) throw new Error('LOG_LEVEL must be debug, info, warn, or error')

  return {
    production,
    port: integer(environment.PORT, 4000, 'PORT', 1, 65535),
    databaseUrl: databaseUrl(rawDatabaseUrl, production),
    sessionSecret: secret,
    frontendOrigin: exactOrigin(environment.FRONTEND_ORIGIN ?? 'http://localhost:5173', production),
    invitationTtlHours: integer(environment.INVITATION_TTL_HOURS, 168, 'INVITATION_TTL_HOURS', 1, 720),
    verificationTtlMinutes: integer(environment.VERIFICATION_TTL_MINUTES, 1440, 'VERIFICATION_TTL_MINUTES', 5, 10080),
    passwordResetTtlMinutes: integer(environment.PASSWORD_RESET_TTL_MINUTES, 60, 'PASSWORD_RESET_TTL_MINUTES', 5, 1440),
    requireEmailVerification,
    trustProxyHops: integer(environment.TRUST_PROXY_HOPS, production ? 1 : 1, 'TRUST_PROXY_HOPS', 1, 3),
    logLevel: logLevel as ServerConfig['logLevel'],
    emailOutboxKey,
  }
}
