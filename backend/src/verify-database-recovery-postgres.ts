import 'dotenv/config'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  buildPostgresToolInvocation,
  createRecoveryDatabaseName,
  postgresAdminDatabaseUrl,
  quotePostgresIdentifier,
  quoteRecoveryDatabaseIdentifier,
  recoveryCleanupFailure,
  type PostgresToolInvocation,
} from './database-recovery.js'
import { runMigrations } from './migrations.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')

const databaseUrl = process.env.DATABASE_URL
const recoveryDatabase = createRecoveryDatabaseName()
const recoveryIdentifier = quoteRecoveryDatabaseIdentifier(recoveryDatabase)
const sqlDirectory = fileURLToPath(new URL('../sql/', import.meta.url))
const expectedMigrations = (await readdir(sqlDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
const scratchDirectory = await mkdtemp(join(tmpdir(), 'projectflow-recovery-'))
const dumpFile = join(scratchDirectory, 'projectflow.dump')
const sourcePool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
const recoveryAdminUrl = process.env.RECOVERY_ADMIN_DATABASE_URL ?? databaseUrl
const adminPool = new pg.Pool({ connectionString: postgresAdminDatabaseUrl(recoveryAdminUrl), max: 1 })
let recoveryPool: pg.Pool | undefined
let recoveryDatabaseCreated = false
let primaryError: unknown

const criticalTables = [
  'users',
  'workspaces',
  'workspace_members',
  'projects',
  'tasks',
  'comments',
  'workspace_invitations',
  'activity_events',
  'auth_tokens',
  'session',
  'email_outbox',
] as const

function toolEnvironment() {
  const inheritedNames = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LD_LIBRARY_PATH'] as const
  return Object.fromEntries(inheritedNames.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []))
}

function runPostgresTool(invocation: PostgresToolInvocation) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: { ...toolEnvironment(), ...invocation.environment },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let standardError = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { standardError = `${standardError}${chunk}`.slice(-4000) })
    child.once('error', () => reject(new Error(`${invocation.command} could not be started`)))
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${invocation.command} failed with exit code ${code}: ${standardError.trim()}`))
    })
  })
}

async function migrationLedger(pool: pg.Pool) {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
  return result.rows.map((row) => row.name)
}

async function tableCounts(pool: pg.Pool) {
  const counts: Record<string, string> = {}
  for (const table of criticalTables) {
    const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`)
    counts[table] = result.rows[0]?.count ?? 'missing'
  }
  return counts
}

async function verifyRollback(pool: pg.Pool) {
  const probeDirectory = join(scratchDirectory, 'rollback-probe')
  await mkdir(probeDirectory)
  for (const name of expectedMigrations) await copyFile(join(sqlDirectory, name), join(probeDirectory, name))
  const probeName = '999_recovery_rollback_probe.sql'
  await writeFile(join(probeDirectory, probeName), [
    'CREATE TABLE projectflow_recovery_rollback_probe (id INTEGER);',
    'SELECT projectflow_recovery_function_that_must_not_exist();',
  ].join('\n'))

  let failedAsExpected = false
  try {
    await runMigrations(pool, probeDirectory)
  } catch {
    failedAsExpected = true
  }
  if (!failedAsExpected) throw new Error('Rollback probe migration unexpectedly succeeded')

  const result = await pool.query<{ probe_table: string | null; ledger_rows: string }>(
    `SELECT to_regclass('public.projectflow_recovery_rollback_probe')::text AS probe_table,
      (SELECT count(*)::text FROM schema_migrations WHERE name = $1) AS ledger_rows`,
    [probeName],
  )
  if (result.rows[0]?.probe_table || result.rows[0]?.ledger_rows !== '0') {
    throw new Error('Failed migration left schema or ledger changes behind')
  }
}

async function verifyReadWrite(pool: pg.Pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE projectflow_recovery_smoke (value INTEGER NOT NULL) ON COMMIT DROP')
    await client.query('INSERT INTO projectflow_recovery_smoke(value) VALUES (1)')
    const result = await client.query<{ value: number }>('SELECT value FROM projectflow_recovery_smoke')
    if (result.rows[0]?.value !== 1) throw new Error('Recovery database read/write smoke test failed')
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

try {
  await sourcePool.query('SELECT 1')
  const sourceLedger = await migrationLedger(sourcePool)
  if (JSON.stringify(sourceLedger) !== JSON.stringify(expectedMigrations)) {
    throw new Error('Source migration ledger does not match the numbered SQL files')
  }
  const sourceCounts = await tableCounts(sourcePool)
  const sourceRoleResult = await sourcePool.query<{ current_user: string }>('SELECT current_user')
  const sourceRole = sourceRoleResult.rows[0]?.current_user
  if (!sourceRole) throw new Error('Unable to determine the source database owner role')

  await runPostgresTool(buildPostgresToolInvocation({
    tool: 'pg_dump',
    databaseUrl,
    dumpFile,
    binDirectory: process.env.POSTGRES_BIN_DIR,
  }))

  await adminPool.query(`CREATE DATABASE ${recoveryIdentifier} OWNER ${quotePostgresIdentifier(sourceRole)} TEMPLATE template0`)
  recoveryDatabaseCreated = true
  await runPostgresTool(buildPostgresToolInvocation({
    tool: 'pg_restore',
    databaseUrl,
    databaseName: recoveryDatabase,
    dumpFile,
    binDirectory: process.env.POSTGRES_BIN_DIR,
  }))

  const recoveryUrl = new URL(databaseUrl)
  recoveryUrl.pathname = `/${recoveryDatabase}`
  recoveryPool = new pg.Pool({ connectionString: recoveryUrl.toString(), max: 2 })
  await recoveryPool.query('SELECT 1')

  const restoredLedger = await migrationLedger(recoveryPool)
  if (JSON.stringify(restoredLedger) !== JSON.stringify(sourceLedger)) throw new Error('Restored migration ledger differs from source')
  const restoredCounts = await tableCounts(recoveryPool)
  if (JSON.stringify(restoredCounts) !== JSON.stringify(sourceCounts)) throw new Error('Restored critical-table row counts differ from source')

  const migrationResult = await runMigrations(recoveryPool, sqlDirectory)
  if (migrationResult.applied.length !== 0 || JSON.stringify(migrationResult.skipped) !== JSON.stringify(expectedMigrations)) {
    throw new Error('Restored database migrations are not idempotently current')
  }
  await verifyRollback(recoveryPool)
  await verifyReadWrite(recoveryPool)

  console.log(`PostgreSQL recovery verification passed (${expectedMigrations.length} migrations, ${criticalTables.length} table counts, rollback probe passed).`)
} catch (error) {
  primaryError = error
  throw error
} finally {
  await recoveryPool?.end().catch(() => undefined)
  await sourcePool.end().catch(() => undefined)
  try {
    if (recoveryDatabaseCreated) await adminPool.query(`DROP DATABASE ${recoveryIdentifier} WITH (FORCE)`)
  } catch (cleanupError) {
    throw recoveryCleanupFailure(primaryError, cleanupError)
  } finally {
    await adminPool.end().catch(() => undefined)
    await rm(scratchDirectory, { recursive: true, force: true })
  }
}
