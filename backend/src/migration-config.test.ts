import { describe, expect, it } from 'vitest'
import { loadMigrationDatabaseUrl } from './migration-config.js'

describe('migration database connection selection', () => {
  const pooled = 'postgresql://projectflow:test@ep-example-pooler.ap-southeast-1.aws.neon.tech/projectflow?sslmode=require'
  const direct = 'postgresql://projectflow:test@ep-example.ap-southeast-1.aws.neon.tech/projectflow?sslmode=require'

  it('uses the dedicated direct URL instead of the pooled runtime URL in production', () => {
    expect(loadMigrationDatabaseUrl({
      NODE_ENV: 'production',
      DATABASE_URL: pooled,
      MIGRATION_DATABASE_URL: direct,
    })).toBe(direct)
  })

  it('requires a dedicated migration URL in production', () => {
    expect(() => loadMigrationDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: pooled }))
      .toThrow('MIGRATION_DATABASE_URL is required')
  })

  it('rejects a Neon pooled endpoint for production migrations', () => {
    expect(() => loadMigrationDatabaseUrl({
      NODE_ENV: 'production',
      DATABASE_URL: pooled,
      MIGRATION_DATABASE_URL: pooled,
    })).toThrow('must use a direct PostgreSQL endpoint')
  })

  it('rejects a production migration URL without an approved TLS mode', () => {
    expect(() => loadMigrationDatabaseUrl({
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: 'postgresql://projectflow:test@ep-example.ap-southeast-1.aws.neon.tech/projectflow',
    })).toThrow('must include sslmode=require or stronger')
  })

  it('falls back to DATABASE_URL outside production for local and CI databases', () => {
    expect(loadMigrationDatabaseUrl({ DATABASE_URL: 'postgresql://projectflow:test@localhost:5432/projectflow' }))
      .toBe('postgresql://projectflow:test@localhost:5432/projectflow')
  })
})
