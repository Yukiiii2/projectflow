import 'dotenv/config'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { runMigrations } from './migrations.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')
const directory = fileURLToPath(new URL('../sql/', import.meta.url))
const expected = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 })

try {
  await Promise.all([runMigrations(pool, directory), runMigrations(pool, directory)])
  const ledger = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
  if (JSON.stringify(ledger.rows.map((row) => row.name)) !== JSON.stringify(expected)) {
    throw new Error('Migration ledger does not match the numbered SQL files')
  }
  const runtimeObjects = await pool.query<{ session_table: string | null; outbox_table: string | null; active_token_index: string | null }>(
    "SELECT to_regclass('public.session')::text AS session_table, to_regclass('public.email_outbox')::text AS outbox_table, to_regclass('public.idx_auth_tokens_one_active')::text AS active_token_index",
  )
  if (!runtimeObjects.rows[0]?.session_table || !runtimeObjects.rows[0]?.outbox_table || !runtimeObjects.rows[0]?.active_token_index) {
    throw new Error('Runtime session, outbox, or active-token migration object is missing')
  }
  console.log(`PostgreSQL migration verification passed (${expected.length} tracked migrations, concurrent runners serialized).`)
} finally {
  await pool.end()
}
