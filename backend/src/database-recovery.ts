import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'

const RECOVERY_DATABASE_NAME = /^projectflow_recovery_verify_[0-9a-f]{32}$/

export interface PostgresToolInvocation {
  command: string
  args: string[]
  environment: Record<string, string>
}

export function createRecoveryDatabaseName(id = randomUUID()) {
  const compactId = id.replaceAll('-', '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(compactId)) throw new Error('Recovery database id must contain exactly 32 hexadecimal characters')
  return assertRecoveryDatabaseName(`projectflow_recovery_verify_${compactId}`)
}

export function assertRecoveryDatabaseName(name: string) {
  if (!RECOVERY_DATABASE_NAME.test(name)) throw new Error('Refusing unsafe recovery database name')
  return name
}

export function quoteRecoveryDatabaseIdentifier(name: string) {
  return `"${assertRecoveryDatabaseName(name)}"`
}

export function quotePostgresIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

export function postgresAdminDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL')
  url.pathname = '/postgres'
  return url.toString()
}

export function recoveryCleanupFailure(primaryError: unknown, cleanupError: unknown) {
  if (!primaryError) return cleanupError
  return new AggregateError([primaryError, cleanupError], 'Recovery verification and disposable database cleanup both failed')
}

function postgresEnvironment(databaseUrl: string, databaseName?: string) {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL')

  const sourceDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!sourceDatabase) throw new Error('DATABASE_URL must name a database')
  const environment: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName ?? sourceDatabase,
  }
  const sslMode = url.searchParams.get('sslmode')
  if (sslMode) environment.PGSSLMODE = sslMode
  return environment
}

export function buildPostgresToolInvocation({
  tool,
  databaseUrl,
  dumpFile,
  databaseName,
  binDirectory,
  platform = process.platform,
}: {
  tool: 'pg_dump' | 'pg_restore'
  databaseUrl: string
  dumpFile: string
  databaseName?: string
  binDirectory?: string
  platform?: NodeJS.Platform
}): PostgresToolInvocation {
  if (tool === 'pg_restore') assertRecoveryDatabaseName(databaseName ?? '')
  const executable = platform === 'win32' ? `${tool}.exe` : tool
  const pathApi = platform === 'win32' ? win32 : posix
  const command = binDirectory ? pathApi.join(binDirectory, executable) : executable
  const args = tool === 'pg_dump'
    ? ['--format=custom', `--file=${dumpFile}`, '--no-owner', '--no-privileges']
    : ['--dbname', databaseName!, '--exit-on-error', '--no-owner', '--no-privileges', dumpFile]

  return {
    command,
    args,
    environment: postgresEnvironment(databaseUrl, databaseName),
  }
}
