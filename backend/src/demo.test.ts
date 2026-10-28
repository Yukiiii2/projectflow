import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DataType, newDb } from 'pg-mem'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { createDemoInstance, deleteDemoInstance, DemoCapacityError, DemoQuotaError, withDemoQuota } from './demo.js'

const pools: Pool[] = []
const now = new Date()

async function context() {
  const memory = newDb({ autoCreateForeignKeyIndices: true })
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: randomUUID })
  memory.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1 })
  const files = await Promise.all(['001_init.sql', '002_collaboration.sql', '003_account_security.sql', '006_portfolio_demo.sql']
    .map((name) => readFile(fileURLToPath(new URL(`../sql/${name}`, import.meta.url)), 'utf8')))
  memory.public.none(files.join('\n').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''))
  const adapter = memory.adapters.createPg()
  const pool = new adapter.Pool() as unknown as Pool
  pools.push(pool)
  return pool
}

afterEach(async () => { await Promise.all(pools.splice(0).map((pool) => pool.end())) })

describe('portfolio demo lifecycle', () => {
  it('creates one private 30-minute instance with realistic collaborative data', async () => {
    const pool = await context()
    const identity = await createDemoInstance(pool, now)

    expect(identity.expiresAt.getTime() - now.getTime()).toBe(1_800_000)
    expect(identity.user).toMatchObject({ name: 'Demo Visitor', demo: true, email_verified: true })
    expect(identity.user.email).toMatch(/@demo\.projectflow\.invalid$/)
    expect((await pool.query('SELECT id FROM demo_instances')).rows).toHaveLength(1)
    const users = await pool.query('SELECT name,email,password_hash,demo_instance_id FROM users ORDER BY name')
    expect(users.rows).toHaveLength(3)
    expect(users.rows.every((user) => user.demo_instance_id === identity.instanceId)).toBe(true)
    expect(users.rows.every((user) => user.password_hash === '!demo-login-disabled!')).toBe(true)
    expect((await pool.query('SELECT id,name,created_by,demo_instance_id FROM workspaces')).rows).toEqual([
      expect.objectContaining({ id: identity.workspaceId, name: 'Northstar Product Studio', demo_instance_id: identity.instanceId }),
    ])
    expect((await pool.query('SELECT id FROM projects')).rows).toHaveLength(3)
    expect((await pool.query("SELECT status,count(*)::int AS count FROM tasks GROUP BY status ORDER BY status")).rows).toEqual([
      { status: 'done', count: 4 },
      { status: 'in_progress', count: 4 },
      { status: 'todo', count: 4 },
    ])
    expect((await pool.query('SELECT id FROM comments')).rows.length).toBeGreaterThanOrEqual(2)
    expect((await pool.query('SELECT id FROM activity_events')).rows.length).toBeGreaterThanOrEqual(4)
  })

  it('removes expired instances before enforcing the active capacity limit', async () => {
    const pool = await context()
    for (let index = 0; index < 24; index += 1) {
      await pool.query('INSERT INTO demo_instances(expires_at) VALUES ($1)', [new Date(now.getTime() + 60 * 60 * 1000)])
    }
    await pool.query('INSERT INTO demo_instances(expires_at) VALUES ($1)', [new Date(now.getTime() - 1000)])

    expect((await createDemoInstance(pool, now)).instanceId).toBeTruthy()
    expect((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM demo_instances')).rows[0]?.count).toBe(25)
    await expect(createDemoInstance(pool, now)).rejects.toBeInstanceOf(DemoCapacityError)
  })

  it('deletes only the selected instance and is safe to repeat', async () => {
    const pool = await context()
    const first = await createDemoInstance(pool, now)
    const second = await createDemoInstance(pool, now)

    await deleteDemoInstance(pool, first.instanceId)
    await deleteDemoInstance(pool, first.instanceId)

    expect((await pool.query('SELECT id FROM demo_instances')).rows).toEqual([{ id: second.instanceId }])
    expect((await pool.query('SELECT id FROM users WHERE demo_instance_id=$1', [first.instanceId])).rows).toEqual([])
    expect((await pool.query('SELECT id FROM workspaces WHERE demo_instance_id=$1', [first.instanceId])).rows).toEqual([])
    expect((await pool.query('SELECT id FROM users WHERE demo_instance_id=$1', [second.instanceId])).rows).toHaveLength(3)
  })

  it('refuses work beyond the per-instance project quota', async () => {
    const pool = await context()
    const demo = await createDemoInstance(pool, now)
    await pool.query('INSERT INTO projects(workspace_id,name,description) VALUES ($1,$2,$3)', [demo.workspaceId, 'Fourth project', ''])
    const create = (name: string) => withDemoQuota(pool, demo.instanceId, 'projects', async (client) => {
      const result = await client.query<{ id: string }>('INSERT INTO projects(workspace_id,name,description) VALUES ($1,$2,$3) RETURNING id', [demo.workspaceId, name, ''])
      return result.rows[0]!.id
    })

    await expect(create('Fifth project')).resolves.toBeTruthy()
    await expect(create('Sixth project')).rejects.toBeInstanceOf(DemoQuotaError)
    expect((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM projects')).rows[0]?.count).toBe(5)
  })
})
