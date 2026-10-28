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
const password = 'correct horse battery staple'
const pools: Pool[] = []

async function context(emailOutbox?: Parameters<typeof createApp>[0]['emailOutbox']) {
  const memory = newDb({ autoCreateForeignKeyIndices: true })
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: randomUUID })
  const first = await readFile(fileURLToPath(new URL('../sql/001_init.sql', import.meta.url)), 'utf8')
  const collaboration = await readFile(fileURLToPath(new URL('../sql/002_collaboration.sql', import.meta.url)), 'utf8')
  const accountSecurity = await readFile(fileURLToPath(new URL('../sql/003_account_security.sql', import.meta.url)), 'utf8')
  const demo = await readFile(fileURLToPath(new URL('../sql/006_portfolio_demo.sql', import.meta.url)), 'utf8')
  memory.public.none(`${first.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '')}\n${collaboration}\n${accountSecurity}\n${demo}`)
  const adapter = memory.adapters.createPg()
  const pool = new adapter.Pool() as unknown as Pool
  pools.push(pool)
  return {
    pool,
    app: createApp({ db: pool, sessionStore: new session.MemoryStore(), emailOutbox, config: { frontendOrigin: origin, sessionSecret: 'test-session-secret-at-least-32-characters', production: false } }),
  }
}

function register(agent: ReturnType<typeof request.agent>, email: string, name: string) {
  return agent.post('/api/auth/register').set('Origin', origin).send({ email, name, password })
}

afterEach(async () => { await Promise.all(pools.splice(0).map((pool) => pool.end())) })

describe('Stage E collaboration', () => {
  it('enforces the invitation lifecycle and membership role controls', async () => {
    const { app, pool } = await context()
    const owner = request.agent(app); const invitee = request.agent(app); const member = request.agent(app)
    const ownerUser = (await register(owner, 'owner@example.com', 'Owner').expect(201)).body.user
    const inviteeUser = (await register(invitee, 'invitee@example.com', 'Invitee').expect(201)).body.user
    const memberUser = (await register(member, 'member@example.com', 'Member').expect(201)).body.user
    const workspace = (await owner.post('/api/workspaces').set('Origin', origin).send({ name: 'Northstar Studio' }).expect(201)).body.workspace
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [workspace.id, memberUser.id, 'member'])

    await member.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'blocked@example.com', role: 'member' }).expect(403)
    await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'invalid', role: 'member' }).expect(400)
    await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'valid@example.com', role: 'owner' }).expect(400)
    const created = await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'INVITEE@example.com', role: 'admin' }).expect(201)
    expect(created.body.invitation).toMatchObject({ email: 'invitee@example.com', role: 'admin', status: 'pending' })
    expect(created.body.delivery).toMatchObject({ status: 'preview' })
    expect(created.body.delivery.preview_url).toMatch(/^http:\/\/localhost:5173\/invite\//)
    const token = created.body.delivery.preview_url.split('/').at(-1)

    const invitations = await owner.get(`/api/workspaces/${workspace.id}/invitations`).expect(200)
    expect(invitations.body.invitations[0]).not.toHaveProperty('token')
    expect(invitations.body.invitations[0]).not.toHaveProperty('token_hash')
    await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'invitee@example.com', role: 'member' }).expect(409)

    await request(app).get(`/api/invitations/${token}`).expect(200).then((response) => expect(response.body.invitation).toMatchObject({ workspace_name: 'Northstar Studio', email: 'invitee@example.com', status: 'pending' }))
    await member.post(`/api/invitations/${token}/accept`).set('Origin', origin).expect(403, { error: 'Invitation email does not match your account' })
    await invitee.post(`/api/invitations/${token}/accept`).set('Origin', origin).expect(200)
    await invitee.post(`/api/invitations/${token}/accept`).set('Origin', origin).expect(409)
    const acceptedWorkspaces = await invitee.get('/api/workspaces').expect(200)
    expect(acceptedWorkspaces.body.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: workspace.id, role: 'admin' })]))
    await invitee.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'another-admin@example.com', role: 'admin' }).expect(403)
    await invitee.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'admin-invited-member@example.com', role: 'member' }).expect(201)

    await owner.patch(`/api/workspaces/${workspace.id}/members/${inviteeUser.id}`).set('Origin', origin).send({ role: 'member' }).expect(200)
    await member.patch(`/api/workspaces/${workspace.id}/members/${inviteeUser.id}`).set('Origin', origin).send({ role: 'admin' }).expect(403)
    await owner.patch(`/api/workspaces/${workspace.id}/members/${ownerUser.id}`).set('Origin', origin).send({ role: 'member' }).expect(400)

    const revoked = await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'revoked@example.com', role: 'member' }).expect(201)
    await owner.delete(`/api/workspaces/${workspace.id}/invitations/${revoked.body.invitation.id}`).set('Origin', origin).expect(200)
    const revokedToken = revoked.body.delivery.preview_url.split('/').at(-1)
    await request(app).get(`/api/invitations/${revokedToken}`).expect(200).then((response) => expect(response.body.invitation.status).toBe('revoked'))

    const expired = await owner.post(`/api/workspaces/${workspace.id}/invitations`).set('Origin', origin).send({ email: 'expired@example.com', role: 'member' }).expect(201)
    await pool.query('UPDATE workspace_invitations SET expires_at=now()-interval \'1 hour\' WHERE id=$1', [expired.body.invitation.id])
    const expiredToken = expired.body.delivery.preview_url.split('/').at(-1)
    await request(app).get(`/api/invitations/${expiredToken}`).expect(200).then((response) => expect(response.body.invitation.status).toBe('expired'))
  })

  it('enforces comment ownership, moderation, activity, assignments, and workspace isolation', async () => {
    const { app, pool } = await context()
    const owner = request.agent(app); const member = request.agent(app); const outsider = request.agent(app)
    const ownerUser = (await register(owner, 'owner@example.com', 'Owner').expect(201)).body.user
    const memberUser = (await register(member, 'member@example.com', 'Member').expect(201)).body.user
    await register(outsider, 'outsider@example.com', 'Outsider').expect(201)
    const workspace = (await owner.post('/api/workspaces').set('Origin', origin).send({ name: 'Northstar Studio' }).expect(201)).body.workspace
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [workspace.id, memberUser.id, 'member'])
    const project = (await owner.post(`/api/workspaces/${workspace.id}/projects`).set('Origin', origin).send({ name: 'Launch' }).expect(201)).body.project
    const task = (await owner.post(`/api/projects/${project.id}/tasks`).set('Origin', origin).send({ title: 'Review release', assigneeId: memberUser.id }).expect(201)).body.task
    expect(task.assignee_id).toBe(memberUser.id)

    const comment = (await member.post(`/api/tasks/${task.id}/comments`).set('Origin', origin).send({ body: 'Ready for owner review.' }).expect(201)).body.comment
    await member.post(`/api/tasks/${task.id}/comments`).set('Origin', origin).send({ body: '   ' }).expect(400)
    expect(comment).toMatchObject({ author_id: memberUser.id, author_name: 'Member', can_edit: true, can_delete: true })
    await owner.patch(`/api/comments/${comment.id}`).set('Origin', origin).send({ body: 'Owner rewrite' }).expect(403)
    const edited = await member.patch(`/api/comments/${comment.id}`).set('Origin', origin).send({ body: 'Ready for final review.' }).expect(200)
    expect(edited.body.comment.edited_at).toBeTruthy()
    const listed = await owner.get(`/api/tasks/${task.id}/comments`).expect(200)
    expect(listed.body.comments[0]).toMatchObject({ body: 'Ready for final review.', can_edit: false, can_delete: true })

    await outsider.get(`/api/tasks/${task.id}/comments`).expect(404)
    await outsider.get(`/api/tasks/${task.id}/activity`).expect(404)
    await outsider.patch(`/api/comments/${comment.id}`).set('Origin', origin).send({ body: 'Hidden edit' }).expect(404)
    await owner.delete(`/api/comments/${comment.id}`).set('Origin', origin).expect(204)

    await member.patch(`/api/tasks/${task.id}`).set('Origin', origin).send({ status: 'done', assigneeId: ownerUser.id }).expect(200)
    const activity = await owner.get(`/api/tasks/${task.id}/activity`).expect(200)
    expect(activity.body.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'comment.created', actor_name: 'Member' }),
      expect.objectContaining({ action: 'comment.edited', actor_name: 'Member' }),
      expect.objectContaining({ action: 'comment.deleted', actor_name: 'Owner' }),
      expect.objectContaining({ action: 'task.updated', actor_name: 'Member' }),
    ]))

    await owner.patch(`/api/tasks/${task.id}`).set('Origin', origin).send({ assigneeId: memberUser.id }).expect(200)
    await owner.delete(`/api/workspaces/${workspace.id}/members/${memberUser.id}`).set('Origin', origin).expect(200)
    const persisted = await pool.query('SELECT assignee_id FROM tasks WHERE id=$1', [task.id])
    expect(persisted.rows[0]?.assignee_id).toBeNull()
    await member.get(`/api/workspaces/${workspace.id}/members`).expect(404)
  })
})
