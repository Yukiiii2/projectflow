import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from './api'

describe('API base URL', () => {
  it('uses the current origin for an unconfigured production build', () => {
    expect(resolveApiBaseUrl(undefined, '')).toBe('')
  })

  it('keeps the local API default in development and normalizes configured URLs', () => {
    expect(resolveApiBaseUrl(undefined, 'http://localhost:4000')).toBe('http://localhost:4000')
    expect(resolveApiBaseUrl('https://api.example.test/', '')).toBe('https://api.example.test')
  })
})
