import { describe, expect, it } from 'vitest'
import { createIsolatedEmailQaDatabase, tokenFromCapturedUrl } from './email-browser-helpers.test-support.js'

describe('email browser QA helpers', () => {
  it('refuses to create disposable QA state on a non-local database', async () => {
    await expect(createIsolatedEmailQaDatabase('postgresql://ep-example.neon.tech/projectflow?sslmode=require'))
      .rejects.toThrow('loopback PostgreSQL')
  })

  it('accepts only the expected local origin and bearer-link route', () => {
    expect(tokenFromCapturedUrl('http://127.0.0.1:43123/verify-email?token=one-time-token', 'http://127.0.0.1:43123', '/verify-email')).toBe('one-time-token')
    expect(() => tokenFromCapturedUrl('https://attacker.example/verify-email?token=secret', 'http://127.0.0.1:43123', '/verify-email')).toThrow('origin')
    expect(() => tokenFromCapturedUrl('http://127.0.0.1:43123/reset-password?token=secret', 'http://127.0.0.1:43123', '/verify-email')).toThrow('path')
    expect(() => tokenFromCapturedUrl('http://127.0.0.1:43123/verify-email', 'http://127.0.0.1:43123', '/verify-email')).toThrow('token')
  })

})
