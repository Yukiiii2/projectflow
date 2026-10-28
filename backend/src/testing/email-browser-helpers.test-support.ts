import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

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
  const migrationNames = [
    '001_init.sql',
    '002_collaboration.sql',
    '003_account_security.sql',
    '004_runtime_operations.sql',
    '005_email_outbox_retention.sql',
  ]
  try {
    for (const name of migrationNames) {
      const sql = await readFile(fileURLToPath(new URL(`../../sql/${name}`, import.meta.url)), 'utf8')
      await pool.query(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''))
    }
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
