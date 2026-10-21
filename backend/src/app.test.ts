import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import session from 'express-session';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const origin = 'http://localhost:5173';
const password = 'correct horse battery staple';
const pools: Pool[] = [];

async function testContext() {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  const migration = await readFile(
    fileURLToPath(new URL('../sql/001_init.sql', import.meta.url)),
    'utf8',
  );
  const collaboration = await readFile(
    fileURLToPath(new URL('../sql/002_collaboration.sql', import.meta.url)),
    'utf8',
  );
  memory.public.none(`${migration.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '')}\n${collaboration}`);
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  pools.push(pool);
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    config: {
      frontendOrigin: origin,
      sessionSecret: 'test-session-secret-at-least-32-characters',
      production: false,
    },
  });
  return { app, pool };
}

function register(agent: ReturnType<typeof request.agent>, email: string, name = 'Maya Chen') {
  return agent
    .post('/api/auth/register')
    .set('Origin', origin)
    .send({ name, email, password });
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe('ProjectFlow API foundation', () => {
  it('reports database health and protects authenticated endpoints', async () => {
    const { app } = await testContext();

    await request(app).get('/api/health').expect(200, { status: 'ok' });
    await request(app).get('/api/auth/me').expect(401, { error: 'Sign in required' });
    await request(app).get('/api/workspaces').expect(401, { error: 'Sign in required' });
  });

  it('registers, hashes passwords, logs in and invalidates the session on logout', async () => {
    const { app, pool } = await testContext();
    const agent = request.agent(app);

    const registration = await register(agent, 'Maya@Northstar.Studio');
    expect(registration.status).toBe(201);
    expect(registration.body.user.email).toBe('maya@northstar.studio');
    expect(registration.headers['set-cookie']?.[0]).toContain('projectflow.sid=');
    expect(registration.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(registration.headers['set-cookie']?.[0]).toContain('SameSite=Lax');

    const stored = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email=$1',
      ['maya@northstar.studio'],
    );
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(stored.rows[0]!.password_hash, password)).toBe(true);

    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').set('Origin', origin).expect(204);
    await agent.get('/api/auth/me').expect(401);

    await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: 'maya@northstar.studio', password: 'incorrect password' })
      .expect(401, { error: 'Invalid email or password' });

    await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: ' MAYA@NORTHSTAR.STUDIO ', password })
      .expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('rejects unsafe origins, malformed JSON, invalid fields and duplicate emails', async () => {
    const { app } = await testContext();
    const agent = request.agent(app);

    await agent
      .post('/api/auth/register')
      .send({ name: 'Maya Chen', email: 'maya@northstar.studio', password })
      .expect(403, { error: 'Origin not allowed' });

    await agent
      .post('/api/auth/register')
      .set('Origin', origin)
      .send({ name: 'Maya Chen', email: 'not-an-email', password: 'short' })
      .expect(400);

    await agent
      .post('/api/auth/login')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400, { error: 'Invalid JSON body' });

    await register(agent, 'maya@northstar.studio').expect(201);
    await register(request.agent(app), 'MAYA@NORTHSTAR.STUDIO').expect(409, {
      error: 'Email is already registered',
    });
  });

  it('returns a safe 413 response for JSON bodies above the configured limit', async () => {
    const { app } = await testContext();

    await request(app)
      .post('/api/auth/register')
      .set('Origin', origin)
      .send({ name: 'Oversized request', email: 'large@example.com', password: 'x'.repeat(70_000) })
      .expect(413, { error: 'Request body is too large' });
  });

  it('rate limits repeated authentication failures', async () => {
    const { app } = await testContext();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app)
        .post('/api/auth/login')
        .set('Origin', origin)
        .send({ email: 'missing@example.com', password: 'incorrect password' })
        .expect(401);
    }

    const limited = await request(app)
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: 'missing@example.com', password: 'incorrect password' })
      .expect(429, { error: 'Too many authentication attempts. Try again later.' });
    expect(limited.headers['retry-after']).toBeTruthy();
  });

  it('uses a host-bound secure session cookie in production', async () => {
    const { pool } = await testContext();
    const app = createApp({
      db: pool,
      sessionStore: new session.MemoryStore(),
      invitationDelivery: { mode: 'smtp', async send() { return { status: 'sent' }; } },
      config: {
        frontendOrigin: 'https://app.projectflow.example',
        sessionSecret: 'production-session-secret-at-least-32-characters',
        production: true,
      },
    });

    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://app.projectflow.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ name: 'Production User', email: 'production@example.com', password })
      .expect(201);

    const cookie = registration.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('__Host-projectflow.sid=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
  });

  it('rejects the documented placeholder session secret in production', async () => {
    const { pool } = await testContext();

    expect(() => createApp({
      db: pool,
      sessionStore: new session.MemoryStore(),
      invitationDelivery: { mode: 'smtp', async send() { return { status: 'sent' }; } },
      config: {
        frontendOrigin: 'https://app.projectflow.example',
        sessionSecret: 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
        production: true,
      },
    })).toThrow('Production SESSION_SECRET must not use the example placeholder');
  });

  it('enforces workspace isolation and role-based project creation', async () => {
    const { app, pool } = await testContext();
    const owner = request.agent(app);
    const outsider = request.agent(app);
    const member = request.agent(app);

    await register(owner, 'owner@northstar.studio', 'Owner').expect(201);
    const workspaceResponse = await owner
      .post('/api/workspaces')
      .set('Origin', origin)
      .send({ name: 'Northstar Studio' })
      .expect(201);
    const workspaceId = workspaceResponse.body.workspace.id as string;
    expect(workspaceResponse.body.workspace).toMatchObject({
      name: 'Northstar Studio',
      role: 'owner',
    });
    expect(workspaceResponse.body.workspace.created_at).toBeTruthy();

    const ownerWorkspaces = await owner.get('/api/workspaces').expect(200);
    expect(ownerWorkspaces.body.workspaces).toHaveLength(1);
    expect(ownerWorkspaces.body.workspaces[0]).toMatchObject({
      id: workspaceId,
      name: 'Northstar Studio',
      role: 'owner',
    });

    const projectResponse = await owner
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set('Origin', origin)
      .send({ name: 'Website redesign', description: 'Portfolio project' })
      .expect(201);
    const projectId = projectResponse.body.project.id as string;
    expect(projectResponse.body.project).toMatchObject({
      workspace_id: workspaceId,
      name: 'Website redesign',
      task_count: 0,
      completed_task_count: 0,
    });

    await owner
      .patch(`/api/projects/${projectId}`)
      .set('Origin', origin)
      .send({ name: 'Website refresh', description: 'Updated portfolio project' })
      .expect(200);

    const projectDetail = await owner.get(`/api/projects/${projectId}`).expect(200);
    expect(projectDetail.body.project).toMatchObject({
      id: projectId,
      name: 'Website refresh',
      description: 'Updated portfolio project',
    });

    const taskResponse = await owner
      .post(`/api/projects/${projectId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Review homepage wireframes', dueDate: '2026-10-23' })
      .expect(201);
    const taskId = taskResponse.body.task.id as string;
    expect(taskResponse.body.task).toMatchObject({
      project_id: projectId,
      project_name: 'Website refresh',
      status: 'todo',
      priority: 'medium',
      due_date: '2026-10-23',
    });

    const workspaceTasks = await owner.get(`/api/workspaces/${workspaceId}/tasks`).expect(200);
    expect(workspaceTasks.body.tasks).toHaveLength(1);
    expect(workspaceTasks.body.tasks[0]).toMatchObject({ id: taskId, project_id: projectId, due_date: '2026-10-23' });

    const projectWithDueDate = await owner.get(`/api/projects/${projectId}`).expect(200);
    expect(projectWithDueDate.body.project.next_due_date).toBe('2026-10-23');

    await owner
      .patch(`/api/tasks/${taskId}`)
      .set('Origin', origin)
      .send({ status: 'in_progress' })
      .expect(200);
    await owner
      .post(`/api/tasks/${taskId}/comments`)
      .set('Origin', origin)
      .send({ body: 'Ready for review.' })
      .expect(201);

    await owner
      .post(`/api/projects/${projectId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Invalid date', dueDate: '2026-99-99' })
      .expect(400);

    const outsiderRegistration = await register(outsider, 'outsider@example.com', 'Outsider').expect(201);
    await outsider.get('/api/workspaces').expect(200, { workspaces: [] });
    await outsider.get(`/api/workspaces/${workspaceId}/projects`).expect(404);
    await outsider.get(`/api/workspaces/${workspaceId}/tasks`).expect(404);
    await outsider.get(`/api/workspaces/${workspaceId}/members`).expect(404);
    await outsider.get(`/api/projects/${projectId}`).expect(404);
    await outsider.get(`/api/projects/${projectId}/tasks`).expect(404);
    await outsider.get(`/api/tasks/${taskId}/comments`).expect(404);
    await outsider
      .post(`/api/projects/${projectId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Unauthorized task' })
      .expect(404);
    await outsider
      .patch(`/api/tasks/${taskId}`)
      .set('Origin', origin)
      .send({ status: 'done' })
      .expect(404);
    await outsider
      .post(`/api/tasks/${taskId}/comments`)
      .set('Origin', origin)
      .send({ body: 'Unauthorized comment' })
      .expect(404);
    await outsider
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set('Origin', origin)
      .send({ name: 'Unauthorized project' })
      .expect(404);

    const memberRegistration = await register(member, 'member@example.com', 'Member').expect(201);
    await pool.query(
      'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)',
      [workspaceId, memberRegistration.body.user.id, 'member'],
    );
    const memberWorkspaces = await member.get('/api/workspaces').expect(200);
    expect(memberWorkspaces.body.workspaces).toHaveLength(1);
    expect(memberWorkspaces.body.workspaces[0]).toMatchObject({ id: workspaceId, role: 'member' });
    const workspaceMembers = await member.get(`/api/workspaces/${workspaceId}/members`).expect(200);
    expect(workspaceMembers.body.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Owner', role: 'owner' }),
      expect.objectContaining({ id: memberRegistration.body.user.id, name: 'Member', role: 'member' }),
    ]));

    const assignedTask = await owner
      .patch(`/api/tasks/${taskId}`)
      .set('Origin', origin)
      .send({ assigneeId: memberRegistration.body.user.id, priority: 'high' })
      .expect(200);
    expect(assignedTask.body.task).toMatchObject({
      assignee_id: memberRegistration.body.user.id,
      assignee_name: 'Member',
      priority: 'high',
    });

    await owner
      .patch(`/api/tasks/${taskId}`)
      .set('Origin', origin)
      .send({ assigneeId: outsiderRegistration.body.user.id })
      .expect(400, { error: 'Assignee must be a workspace member' });

    await member
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set('Origin', origin)
      .send({ name: 'Member project' })
      .expect(403, { error: 'Insufficient permissions' });
    await member
      .patch(`/api/projects/${projectId}`)
      .set('Origin', origin)
      .send({ name: 'Unauthorized edit' })
      .expect(403, { error: 'Insufficient permissions' });
    await member.get(`/api/workspaces/${workspaceId}/projects`).expect(200);
    await member
      .post(`/api/projects/${projectId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Member-created task', assigneeId: memberRegistration.body.user.id, priority: 'low' })
      .expect(201);
    await member
      .patch(`/api/tasks/${taskId}`)
      .set('Origin', origin)
      .send({ status: 'done' })
      .expect(200);
    const movedTasks = await member.get(`/api/workspaces/${workspaceId}/tasks`).expect(200);
    expect(movedTasks.body.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: taskId, status: 'done' }),
    ]));
    await member
      .post(`/api/tasks/${taskId}/comments`)
      .set('Origin', origin)
      .send({ body: 'Completed.' })
      .expect(201);
    await owner
      .patch(`/api/projects/${projectId}`)
      .set('Origin', origin)
      .send({ archived: true })
      .expect(200);
    await owner.get(`/api/projects/${projectId}`).expect(404);
    await owner.get(`/api/projects/${projectId}/tasks`).expect(404);
    const activeProjects = await owner.get(`/api/workspaces/${workspaceId}/projects`).expect(200);
    expect(activeProjects.body.projects).toEqual([]);
  });

  it('returns a consistent JSON response for unknown routes', async () => {
    const { app } = await testContext();
    await request(app).get('/api/not-a-route').expect(404, { error: 'Route not found' });
  });
});
