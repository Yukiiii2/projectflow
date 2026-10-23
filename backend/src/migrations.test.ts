import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.js'

interface LedgerRow { name: string; checksum: string }

class FakeClient {
  calls: Array<{ text: string; values?: unknown[] }> = []
  ledger: LedgerRow[] = []
  failOn = ''
  released = false
  failUnlock = false

  async query(text: string, values?: unknown[]) {
    this.calls.push({ text, values })
    if (text.includes(this.failOn) && this.failOn) throw new Error('migration failed')
    if (text.includes('pg_advisory_unlock') && this.failUnlock) throw new Error('unlock failed')
    if (text.startsWith('SELECT name, checksum FROM schema_migrations')) return { rows: [...this.ledger] }
    if (text.startsWith('INSERT INTO schema_migrations')) {
      this.ledger.push({ name: String(values?.[0]), checksum: String(values?.[1]) })
    }
    return { rows: [] }
  }

  release() { this.released = true }
}

const directories: string[] = []

async function directoryWith(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'projectflow-migrations-'))
  directories.push(directory)
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(join(directory, name), sql)))
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('migration runner', () => {
  it('locks, applies ordered files transactionally, records checksums, and skips them on repeat', async () => {
    const directory = await directoryWith({
      '002_second.sql': "SELECT 'second migration';",
      '001_first.sql': "SELECT 'first migration';",
      'notes.txt': 'ignored',
    })
    const client = new FakeClient()
    const pool = { connect: async () => client }

    const first = await runMigrations(pool, directory)
    expect(first).toEqual({ applied: ['001_first.sql', '002_second.sql'], skipped: [] })
    expect(client.ledger.map((row) => row.name)).toEqual(['001_first.sql', '002_second.sql'])
    expect(client.calls[0]?.text).toContain('pg_advisory_lock')
    expect(client.calls.map((call) => call.text)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
    expect(client.calls.at(-1)?.text).toContain('pg_advisory_unlock')

    client.calls = []
    const repeated = await runMigrations(pool, directory)
    expect(repeated).toEqual({ applied: [], skipped: ['001_first.sql', '002_second.sql'] })
    expect(client.calls.some((call) => call.text.includes('first migration'))).toBe(false)
    expect(client.calls.some((call) => call.text.includes('second migration'))).toBe(false)
  })

  it('rejects a changed applied migration and always releases the lock', async () => {
    const directory = await directoryWith({ '001_first.sql': "SELECT 'changed';" })
    const client = new FakeClient()
    client.ledger.push({ name: '001_first.sql', checksum: 'different-checksum' })

    await expect(runMigrations({ connect: async () => client }, directory)).rejects.toThrow('checksum mismatch')
    expect(client.calls.at(-1)?.text).toContain('pg_advisory_unlock')
  })

  it('rolls back a failed file without recording it', async () => {
    const directory = await directoryWith({ '001_first.sql': 'FAIL THIS MIGRATION;' })
    const client = new FakeClient()
    client.failOn = 'FAIL THIS MIGRATION'

    await expect(runMigrations({ connect: async () => client }, directory)).rejects.toThrow('migration failed')
    expect(client.calls.some((call) => call.text === 'ROLLBACK')).toBe(true)
    expect(client.ledger).toEqual([])
    expect(client.calls.at(-1)?.text).toContain('pg_advisory_unlock')
  })

  it('releases the checked-out client when advisory unlock fails', async () => {
    const directory = await directoryWith({ '001_first.sql': 'SELECT 1;' })
    const client = new FakeClient()
    client.failUnlock = true

    await expect(runMigrations({ connect: async () => client }, directory)).rejects.toThrow('unlock failed')
    expect(client.released).toBe(true)
  })
})
