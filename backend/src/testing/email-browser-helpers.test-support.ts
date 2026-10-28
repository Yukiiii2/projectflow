import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { runMigrations } from '../migrations.js'

export interface IsolatedEmailQaDatabase {
  pool: Pool
  schema: string
  dispose(): Promise<void>
}

export async function createIsolatedEmailQaDatabase(databaseUrl: string): Promise<IsolatedEmailQaDatabase> {
  const url = new URL(databaseUrl)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Email browser QA requires a loopback PostgreSQL connection')
  }
  const schema = `projectflow_email_qa_${randomBytes(8).toString('hex')}`
  const admin = new Pool({ connectionString: databaseUrl })
  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schema},public`)
  const pool = new Pool({ connectionString: scopedUrl.toString() })
  let disposed = false
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const directory = fileURLToPath(new URL('../../sql/', import.meta.url))
  const migrationNames = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
  try {
    const first = await runMigrations(pool, directory)
    const replay = await runMigrations(pool, directory)
    if (first.applied.length !== migrationNames.length || replay.skipped.length !== migrationNames.length) throw new Error('Disposable schema migration replay was incomplete')
  } catch (error) {
    await pool.end()
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
    throw error
  }
  return {
    pool,
    schema,
    async dispose() {
      if (disposed) return
      disposed = true
      await pool.end()
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await admin.end()
      }
    },
  }
}

export function tokenFromCapturedUrl(value: string, expectedOrigin: string, expectedPath: string) {
  const url = new URL(value)
  if (url.origin !== expectedOrigin) throw new Error('Captured email URL has an unexpected origin')
  if (url.pathname !== expectedPath) throw new Error('Captured email URL has an unexpected path')
  const token = url.searchParams.get('token')
  if (!token) throw new Error('Captured email URL has no token')
  return token
}
