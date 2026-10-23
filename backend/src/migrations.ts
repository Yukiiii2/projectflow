import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

interface QueryResult { rows: unknown[] }
interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>
  release(): void
}
interface MigrationPool { connect(): Promise<MigrationClient> }

const MIGRATION_LOCK_KEY = 73_920_126

function checksum(sql: string) {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export async function runMigrations(pool: MigrationPool, directory: string) {
  const client = await pool.connect()
  let locked = false
  const applied: string[] = []
  const skipped: string[] = []
  let primaryError: unknown
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    locked = true
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    const existing = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name')
    const recorded = new Map((existing.rows as Array<{ name: string; checksum: string }>).map((row) => [row.name, row.checksum]))
    const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()

    for (const name of files) {
      const sql = await readFile(join(directory, name), 'utf8')
      const digest = checksum(sql)
      const previous = recorded.get(name)
      if (previous) {
        if (previous !== digest) throw new Error(`Migration checksum mismatch: ${name}`)
        skipped.push(name)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, digest])
        await client.query('COMMIT')
        applied.push(name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return { applied, skipped }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    } catch (unlockError) {
      if (!primaryError) throw unlockError
    } finally {
      client.release()
    }
  }
}
