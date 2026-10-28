import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import session from 'express-session'
import { DataType, newDb } from 'pg-mem'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const origin = 'http://localhost:5173'
const pools: Pool[] = []

async function context(demoModeEnabled = true, sessionStore: session.Store = new session.MemoryStore()) {
  const memory = newDb({ autoCreateForeignKeyIndices: true })
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: randomUUID })
  memory.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1 })
  const files = await Promise.all(['001_init.sql', '002_collaboration.sql', '003_account_security.sql', '006_portfolio_demo.sql']
    .map((name) => readFile(fileURLToPath(new URL(`../sql/${name}`, import.meta.url)), 'utf8')))
  memory.public.none(files.join('\n').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''))
  const adapter = memory.adapters.createPg()
  const pool = new adapter.Pool() as unknown as Pool
  pools.push(pool)
  const app = createApp({
    db: pool,
    sessionStore,
    config: {
      frontendOrigin: origin,
      sessionSecret: 'test-session-secret-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      demoModeEnabled,
    },
  })
  return { app, pool }
}

function enterDemo(agent: ReturnType<typeof request.agent>) {
  return agent.post('/api/auth/demo').set('Origin', origin).send({})
}

afterEach(async () => { await Promise.all(pools.splice(0).map((pool) => pool.end())) })

describe('portfolio demo API', () => {
  it('is unavailable unless explicitly enabled', async () => {
    const { app } = await context(false)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app).post('/api/auth/demo').set('Origin', origin).send({}).expect(404, { error: 'Route not found' })
    }
  })

  it('does not replace an existing authenticated session with an orphaned demo', async () => {
    const { app, pool } = await context()
    const agent = request.agent(app)
    await enterDemo(agent).expect(201)
    await enterDemo(agent).expect(409, { error: 'Sign out before starting another demo' })
    expect((await pool.query('SELECT id FROM demo_instances')).rows).toHaveLength(1)
  })

  it('removes seeded rows if session initialization fails', async () => {
    class FailingStore extends session.MemoryStore {
      override destroy(_sid: string, callback?: (error?: unknown) => void) { callback?.(new Error('session unavailable')) }
    }
    const { app, pool } = await context(true, new FailingStore())
    await request(app).post('/api/auth/demo').set('Origin', origin).send({}).expect(500)
    expect((await pool.query('SELECT id FROM demo_instances')).rows).toEqual([])
  })

  it('creates isolated 30-minute sessions that use the real workspace APIs', async () => {
    const { app } = await context()
    const first = request.agent(app)
    const second = request.agent(app)

    const firstEntry = await enterDemo(first).expect(201)
    const secondEntry = await enterDemo(second).expect(201)
    expect(firstEntry.body.user).toMatchObject({ name: 'Demo Visitor', demo: true, email_verified: true })
    const cookieExpiry = /Expires=([^;]+)/.exec(firstEntry.headers['set-cookie']?.[0] ?? '')?.[1]
    expect(new Date(cookieExpiry!).getTime() - new Date(firstEntry.headers.date!).getTime()).toBe(1_800_000)
    expect(secondEntry.body.user.id).not.toBe(firstEntry.body.user.id)

    const firstWorkspace = (await first.get('/api/workspaces').expect(200)).body.workspaces[0]
    const secondWorkspace = (await second.get('/api/workspaces').expect(200)).body.workspaces[0]
    expect(firstWorkspace.id).not.toBe(secondWorkspace.id)
    await first.get(`/api/workspaces/${secondWorkspace.id}/projects`).expect(404)
    await first.get(`/api/workspaces/${firstWorkspace.id}/projects`).expect(200)
    await first.get(`/api/workspaces/${firstWorkspace.id}/tasks`).expect(200)
    await first.get(`/api/workspaces/${firstWorkspace.id}/members`).expect(200)
  })

  it('blocks account, invitation, membership, and additional-workspace privileges', async () => {
    const { app, pool } = await context()
    const agent = request.agent(app)
    const entry = await enterDemo(agent).expect(201)
    const workspace = (await agent.get('/api/workspaces').expect(200)).body.workspaces[0]
    const members = (await agent.get(`/api/workspaces/${workspace.id}/members`).expect(200)).body.members

    await agent.post('/api/workspaces').set('Origin', origin).send({ name: 'Not allowed' }).expect(403)
    await agent.get(`/api/workspaces/${workspace.id}/invitations`).expect(403)
    await agent.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'person@example.com', role: 'member' }).expect(403)
    await agent.patch(`/api/workspaces/${workspace.id}/members/${members[1].id}`).set('Origin', origin).send({ role: 'member' }).expect(403)
    await request(app).post('/api/auth/login').set('Origin', origin).send({ email: entry.body.user.email, password: 'not-a-real-password' }).expect(401)
    await request(app).post('/api/auth/password-reset/request').set('Origin', origin).send({ email: entry.body.user.email }).expect(202)
    expect((await pool.query("SELECT id FROM auth_tokens WHERE purpose='password_reset'")).rows).toEqual([])
  })

  it('enforces per-instance resource quotas and cleans the instance on expiry and logout', async () => {
    const { app, pool } = await context()
    const expired = request.agent(app)
    const expiredEntry = await enterDemo(expired).expect(201)
    const workspace = (await expired.get('/api/workspaces').expect(200)).body.workspaces[0]

    await expired.post(`/api/workspaces/${workspace.id}/projects`).set('Origin', origin).send({ name: 'Fourth' }).expect(201)
    await expired.post(`/api/workspaces/${workspace.id}/projects`).set('Origin', origin).send({ name: 'Fifth' }).expect(201)
    await expired.post(`/api/workspaces/${workspace.id}/projects`).set('Origin', origin).send({ name: 'Sixth' }).expect(409, { error: 'Demo projects limit reached' })

    const expiredInstance = (await pool.query<{ demo_instance_id: string }>('SELECT demo_instance_id FROM users WHERE id=$1', [expiredEntry.body.user.id])).rows[0]!.demo_instance_id
    await pool.query('UPDATE demo_instances SET expires_at=now() WHERE id=$1', [expiredInstance])
    await expired.get('/api/workspaces').expect(401, { error: 'Demo session expired' })
    expect((await pool.query('SELECT id FROM demo_instances WHERE id=$1', [expiredInstance])).rows).toEqual([])

    const active = request.agent(app)
    const activeEntry = await enterDemo(active).expect(201)
    const activeInstance = (await pool.query<{ demo_instance_id: string }>('SELECT demo_instance_id FROM users WHERE id=$1', [activeEntry.body.user.id])).rows[0]!.demo_instance_id
    await active.post('/api/auth/logout').set('Origin', origin).expect(204)
    expect((await pool.query('SELECT id FROM demo_instances WHERE id=$1', [activeInstance])).rows).toEqual([])
  })

  it('applies task and comment quotas through the public APIs', async () => {
    const { app, pool } = await context()
    const agent = request.agent(app)
    await enterDemo(agent).expect(201)
    const workspace = (await agent.get('/api/workspaces').expect(200)).body.workspaces[0]
    const project = (await agent.get(`/api/workspaces/${workspace.id}/projects`).expect(200)).body.projects[0]
    const task = (await agent.get(`/api/projects/${project.id}/tasks`).expect(200)).body.tasks[0]

    const taskCount = Number((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM tasks')).rows[0]!.count)
    for (let index = taskCount; index < 40; index += 1) {
      await pool.query('INSERT INTO tasks(project_id,title,description,status,priority) VALUES ($1,$2,$3,$4,$5)', [project.id, `Quota task ${index}`, '', 'todo', 'medium'])
    }
    await agent.post(`/api/projects/${project.id}/tasks`).set('Origin', origin).send({ title: 'One too many' }).expect(409, { error: 'Demo tasks limit reached' })

    const commentCount = Number((await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM comments')).rows[0]!.count)
    for (let index = commentCount; index < 50; index += 1) {
      await pool.query('INSERT INTO comments(task_id,author_id,body) VALUES ($1,(SELECT created_by FROM workspaces WHERE id=$2),$3)', [task.id, workspace.id, `Quota comment ${index}`])
    }
    await agent.post(`/api/tasks/${task.id}/comments`).set('Origin', origin).send({ body: 'One too many' }).expect(409, { error: 'Demo comments limit reached' })
  })

  it('limits demo creation to five attempts per IP per hour', async () => {
    const { app } = await context()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/auth/demo').set('Origin', origin).send({}).expect(201)
    }
    await request(app).post('/api/auth/demo').set('Origin', origin).send({}).expect(429)
  })
})
