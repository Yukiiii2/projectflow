import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import session from 'express-session'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { loadServerConfig } from './config.js'
import { disabledInvitationDelivery } from './invitation-delivery.js'
import { createLogger, redactLogValue } from './logger.js'

const temporaryDirectories: string[] = []
const outboxKey = Buffer.alloc(32, 7).toString('base64')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('production readiness configuration', () => {
  it('accepts the same-origin TLS production configuration', () => {
    const config = loadServerConfig({
      NODE_ENV: 'production',
      PORT: '10000',
      DATABASE_URL: 'postgresql://projectflow:test-database-password@pooler.example.test/projectflow?sslmode=require',
      SESSION_SECRET: 'a-production-session-secret-with-more-than-32-characters',
      FRONTEND_ORIGIN: 'https://projectflow.example',
      INVITATION_DELIVERY: 'resend',
      RESEND_API_KEY: 'test-resend-secret-value',
      INVITATION_FROM: 'ProjectFlow <invites@projectflow.example>',
      REQUIRE_EMAIL_VERIFICATION: 'true',
      TRUST_PROXY_HOPS: '1',
      EMAIL_OUTBOX_KEY: outboxKey,
    })

    expect(config).toMatchObject({ production: true, port: 10000, trustProxyHops: 1, requireEmailVerification: true, portfolioModeEnabled: false })
  })

  it('accepts explicit portfolio mode without an email provider while preserving verification', () => {
    const config = loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://projectflow:test-database-password@pooler.example.test/projectflow?sslmode=require',
      SESSION_SECRET: 'a-production-session-secret-with-more-than-32-characters',
      FRONTEND_ORIGIN: 'https://projectflow.example',
      REQUIRE_EMAIL_VERIFICATION: 'true',
      TRUST_PROXY_HOPS: '1',
      PORTFOLIO_MODE_ENABLED: 'true',
    })

    expect(config).toMatchObject({
      production: true,
      requireEmailVerification: true,
      portfolioModeEnabled: true,
      emailOutboxKey: undefined,
    })
  })

  it.each([
    ['http frontend', { FRONTEND_ORIGIN: 'http://projectflow.example' }, 'HTTPS'],
    ['unencrypted database', { DATABASE_URL: 'postgresql://user:pass@db.example.test/projectflow' }, 'sslmode=require'],
    ['missing email delivery mode', { INVITATION_DELIVERY: undefined }, 'Production INVITATION_DELIVERY must be set to resend or smtp'],
    ['mis-cased email delivery mode', { INVITATION_DELIVERY: 'Resend' }, 'Production INVITATION_DELIVERY must be set to resend or smtp'],
    ['preview email', { INVITATION_DELIVERY: 'preview' }, 'Production INVITATION_DELIVERY must be set to resend or smtp'],
    ['missing Resend sender', { INVITATION_FROM: undefined }, 'Production Resend API configuration is incomplete'],
    ['Resend testing sender', { INVITATION_FROM: 'ProjectFlow <onboarding@resend.dev>' }, 'verified custom domain'],
    ['disabled verification', { REQUIRE_EMAIL_VERIFICATION: 'false' }, 'email verification'],
    ['invalid proxy hops', { TRUST_PROXY_HOPS: '0' }, 'TRUST_PROXY_HOPS'],
    ['invalid demo switch', { DEMO_MODE_ENABLED: 'yes' }, 'DEMO_MODE_ENABLED'],
    ['invalid portfolio switch', { PORTFOLIO_MODE_ENABLED: 'yes' }, 'PORTFOLIO_MODE_ENABLED'],
    ['placeholder Resend secret', { RESEND_API_KEY: 'REPLACE_WITH_RESEND_API_KEY' }, 'placeholder'],
    ['invalid outbox key', { EMAIL_OUTBOX_KEY: 'not-a-32-byte-key' }, 'EMAIL_OUTBOX_KEY'],
  ])('rejects %s in production', (_label, override, message) => {
    expect(() => loadServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.example.test/projectflow?sslmode=require',
      SESSION_SECRET: 'a-production-session-secret-with-more-than-32-characters',
      FRONTEND_ORIGIN: 'https://projectflow.example',
      INVITATION_DELIVERY: 'resend',
      RESEND_API_KEY: 'test-resend-secret-value',
      INVITATION_FROM: 'ProjectFlow <invites@projectflow.example>',
      REQUIRE_EMAIL_VERIFICATION: 'true',
      TRUST_PROXY_HOPS: '1',
      EMAIL_OUTBOX_KEY: outboxKey,
      ...override,
    })).toThrow(message)
  })

  it('keeps portfolio demo mode disabled unless it is explicitly enabled', () => {
    expect(loadServerConfig({
      DATABASE_URL: 'postgresql://local:local@localhost/projectflow',
      SESSION_SECRET: 'a-development-session-secret-with-32-characters',
    }).demoModeEnabled).toBe(false)
    expect(loadServerConfig({
      DATABASE_URL: 'postgresql://local:local@localhost/projectflow',
      SESSION_SECRET: 'a-development-session-secret-with-32-characters',
      DEMO_MODE_ENABLED: 'true',
    }).demoModeEnabled).toBe(true)
  })
})

describe('same-origin production app', () => {
  it('requires the disabled transport only for explicit production portfolio mode', () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never
    const base = {
      db,
      sessionStore: new session.MemoryStore(),
      config: {
        frontendOrigin: 'https://projectflow.example',
        sessionSecret: 'a-production-session-secret-with-more-than-32-characters',
        production: true,
        requireEmailVerification: true,
      },
    }
    const resendDelivery = { mode: 'resend' as const, async send() { return { status: 'sent' as const } }, async sendVerification() { return { status: 'sent' as const } }, async sendPasswordReset() { return { status: 'sent' as const } } }

    expect(() => createApp({ ...base, invitationDelivery: disabledInvitationDelivery() })).toThrow('configured email transport')
    expect(() => createApp({ ...base, invitationDelivery: resendDelivery, config: { ...base.config, portfolioModeEnabled: true } })).toThrow('must disable email delivery')
    expect(() => createApp({ ...base, invitationDelivery: disabledInvitationDelivery(), config: { ...base.config, portfolioModeEnabled: true } })).not.toThrow()
  })

  it('serves Vite assets and SPA routes without shadowing API 404s', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'projectflow-static-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>ProjectFlow production</title>')
    await writeFile(join(directory, 'assets', 'index-12345678.js'), 'console.log("built")')
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as never
    const app = createApp({
      db,
      sessionStore: new session.MemoryStore(),
      staticAssetsPath: directory,
      invitationDelivery: { mode: 'resend', async send() { return { status: 'sent' } }, async sendVerification() { return { status: 'sent' } }, async sendPasswordReset() { return { status: 'sent' } } },
      config: {
        frontendOrigin: 'https://projectflow.example',
        sessionSecret: 'a-production-session-secret-with-more-than-32-characters',
        production: true,
        trustProxyHops: 1,
        requireEmailVerification: true,
      },
    })

    const page = await request(app).get('/projects/example').set('X-Forwarded-Proto', 'https').expect(200)
    expect(page.text).toContain('ProjectFlow production')
    expect(page.headers['cache-control']).toContain('no-cache')
    expect(page.headers['content-security-policy']).toContain("default-src 'self'")
    expect(page.headers['strict-transport-security']).toBeTruthy()
    expect(page.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)

    const asset = await request(app).get('/assets/index-12345678.js').set('X-Forwarded-Proto', 'https').expect(200)
    expect(asset.headers['cache-control']).toContain('immutable')

    await request(app).get('/api/does-not-exist').set('X-Forwarded-Proto', 'https').expect(404, { error: 'Route not found' })
    await request(app).post('/api/does-not-exist').set('Origin', 'https://projectflow.example').set('X-Forwarded-Proto', 'http').expect(400, { error: 'HTTPS required' })
  })

  it('never redirects an insecure request to a request-controlled host', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never
    const app = createApp({
      db,
      sessionStore: new session.MemoryStore(),
      invitationDelivery: { mode: 'smtp', async send() { return { status: 'sent' } }, async sendVerification() { return { status: 'sent' } }, async sendPasswordReset() { return { status: 'sent' } } },
      config: {
        frontendOrigin: 'https://projectflow.example',
        sessionSecret: 'a-production-session-secret-with-more-than-32-characters',
        production: true,
      },
    })

    const response = await request(app).get('//attacker.example/redirect').set('X-Forwarded-Proto', 'http').expect(308)
    expect(new URL(response.headers.location!).origin).toBe('https://projectflow.example')
  })
})

describe('structured logging', () => {
  it('redacts SPA invitation bearer tokens from request logs', async () => {
    const write = vi.fn()
    const logger = createLogger({ level: 'info', write })
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never
    const app = createApp({
      db,
      logger,
      sessionStore: new session.MemoryStore(),
      invitationDelivery: { mode: 'smtp', async send() { return { status: 'sent' } }, async sendVerification() { return { status: 'sent' } }, async sendPasswordReset() { return { status: 'sent' } } },
      config: {
        frontendOrigin: 'https://projectflow.example',
        sessionSecret: 'a-production-session-secret-with-more-than-32-characters',
        production: true,
      },
    })

    await request(app).get('/invite/raw-browser-token').set('X-Forwarded-Proto', 'https').expect(404)

    const requestLog = write.mock.calls.map(([line]) => JSON.parse(line)).find((entry) => entry.event === 'request_completed')
    expect(requestLog).toMatchObject({ path: '/invite/[REDACTED]', status: 404 })
    expect(JSON.stringify(requestLog)).not.toContain('raw-browser-token')
  })

  it('redacts credentials, tokens, and sensitive URL segments', () => {
    expect(redactLogValue('postgresql://user:secret@db.example.test/projectflow')).toBe('postgresql://[REDACTED]@db.example.test/projectflow')
    expect(redactLogValue('/api/invitations/raw-token-value?token=another-secret')).toBe('/api/invitations/[REDACTED]')
  })

  it('writes one JSON object per event', () => {
    const write = vi.fn()
    const logger = createLogger({ level: 'info', write })
    logger.info('server_started', { port: 4000 })
    expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject({ level: 'info', event: 'server_started', port: 4000 })
  })
})
