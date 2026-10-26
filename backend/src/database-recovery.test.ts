import { describe, expect, it } from 'vitest'
import {
  assertRecoveryDatabaseName,
  buildPostgresToolInvocation,
  createRecoveryDatabaseName,
  postgresAdminDatabaseUrl,
  quotePostgresIdentifier,
  quoteRecoveryDatabaseIdentifier,
  recoveryCleanupFailure,
} from './database-recovery.js'

describe('database recovery safety', () => {
  it('creates and accepts only the dedicated disposable database name format', () => {
    const name = createRecoveryDatabaseName('01234567-89ab-4cde-8fab-0123456789ab')

    expect(name).toBe('projectflow_recovery_verify_0123456789ab4cde8fab0123456789ab')
    expect(assertRecoveryDatabaseName(name)).toBe(name)
    expect(() => assertRecoveryDatabaseName('projectflow')).toThrow('Refusing unsafe recovery database name')
    expect(() => assertRecoveryDatabaseName('postgres')).toThrow('Refusing unsafe recovery database name')
    expect(() => assertRecoveryDatabaseName(`${name}; DROP DATABASE projectflow`)).toThrow('Refusing unsafe recovery database name')
  })

  it('keeps decoded credentials out of pg_dump arguments', () => {
    const invocation = buildPostgresToolInvocation({
      tool: 'pg_dump',
      databaseUrl: 'postgresql://projectflow%40local:p%40ss%3Aword@localhost:5433/projectflow?sslmode=require',
      dumpFile: 'C:\\recovery\\projectflow.dump',
      platform: 'win32',
    })

    expect(invocation.command).toBe('pg_dump.exe')
    expect(invocation.args).toEqual([
      '--format=custom',
      '--file=C:\\recovery\\projectflow.dump',
      '--no-owner',
      '--no-privileges',
    ])
    expect(invocation.args.join(' ')).not.toContain('p@ss:word')
    expect(invocation.args.join(' ')).not.toContain('projectflow@local')
    expect(invocation.environment).toEqual({
      PGHOST: 'localhost',
      PGPORT: '5433',
      PGUSER: 'projectflow@local',
      PGPASSWORD: 'p@ss:word',
      PGDATABASE: 'projectflow',
      PGSSLMODE: 'require',
    })
  })

  it('targets the guarded restore database and supports an explicit client-tool directory', () => {
    const databaseName = 'projectflow_recovery_verify_abcdefabcdefabcdefabcdefabcdefab'
    const invocation = buildPostgresToolInvocation({
      tool: 'pg_restore',
      databaseUrl: 'postgresql://projectflow:local-only@127.0.0.1/projectflow',
      databaseName,
      dumpFile: 'D:\\tmp\\projectflow.dump',
      binDirectory: 'C:\\Program Files\\PostgreSQL\\18\\bin',
      platform: 'win32',
    })

    expect(invocation.command).toBe('C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe')
    expect(invocation.args).toEqual([
      '--dbname', databaseName,
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      'D:\\tmp\\projectflow.dump',
    ])
    expect(invocation.environment.PGDATABASE).toBe(databaseName)
    expect(invocation.args.join(' ')).not.toContain('local-only')
  })

  it('quotes only guarded recovery identifiers and selects the administrative database safely', () => {
    const databaseName = 'projectflow_recovery_verify_abcdefabcdefabcdefabcdefabcdefab'

    expect(quoteRecoveryDatabaseIdentifier(databaseName)).toBe(`"${databaseName}"`)
    expect(() => quoteRecoveryDatabaseIdentifier('projectflow')).toThrow('Refusing unsafe recovery database name')
    expect(quotePostgresIdentifier('role"name')).toBe('"role""name"')
    expect(postgresAdminDatabaseUrl('postgresql://user:p%40ss@localhost:5432/projectflow?sslmode=disable'))
      .toBe('postgresql://user:p%40ss@localhost:5432/postgres?sslmode=disable')
  })

  it('preserves both the verification and cleanup failures for operator action', () => {
    const verificationError = new Error('restore validation failed')
    const cleanupError = new Error('drop failed')

    expect(recoveryCleanupFailure(undefined, cleanupError)).toBe(cleanupError)
    const combined = recoveryCleanupFailure(verificationError, cleanupError)
    expect(combined).toBeInstanceOf(AggregateError)
    expect((combined as AggregateError).errors).toEqual([verificationError, cleanupError])
  })
})
