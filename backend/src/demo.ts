import type { Pool, PoolClient } from 'pg'

export const DEMO_LIMITS = {
  lifetimeMinutes: 30,
  activeInstances: 25,
  projects: 5,
  tasks: 40,
  comments: 50,
  activity: 200,
} as const

const DEMO_CREATION_LOCK = 73_920_127
const DISABLED_PASSWORD_HASH = '!demo-login-disabled!'

type DemoResource = 'projects' | 'tasks' | 'comments' | 'activity'
type Queryable = Pick<PoolClient, 'query'>

export interface DemoIdentity {
  instanceId: string
  workspaceId: string
  expiresAt: Date
  user: {
    id: string
    name: string
    email: string
    email_verified: true
    email_verification_required: true
    demo: true
    demo_expires_at: string
  }
}

export class DemoCapacityError extends Error {
  override name = 'DemoCapacityError'
}

export class DemoQuotaError extends Error {
  override name = 'DemoQuotaError'
  constructor(readonly resource: DemoResource) {
    super(`Demo ${resource} limit reached`)
  }
}

export class DemoExpiredError extends Error {
  override name = 'DemoExpiredError'
}

async function deleteDemoRows(client: Queryable, instanceId: string) {
  await client.query('DELETE FROM workspaces WHERE demo_instance_id=$1', [instanceId])
  await client.query('DELETE FROM users WHERE demo_instance_id=$1', [instanceId])
  await client.query('DELETE FROM demo_instances WHERE id=$1', [instanceId])
}

export async function cleanupExpiredDemoInstances(client: Queryable, now = new Date()) {
  const expired = await client.query<{ id: string }>('SELECT id FROM demo_instances WHERE expires_at<=$1 ORDER BY expires_at', [now])
  for (const row of expired.rows) await deleteDemoRows(client, row.id)
  return expired.rows.length
}

export async function deleteDemoInstance(db: Pool, instanceId: string) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await deleteDemoRows(client, instanceId)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function dateAfter(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

export async function createDemoInstance(db: Pool, now = new Date()): Promise<DemoIdentity> {
  const client = await db.connect()
  const expiresAt = new Date(now.getTime() + DEMO_LIMITS.lifetimeMinutes * 60_000)
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [DEMO_CREATION_LOCK])
    await cleanupExpiredDemoInstances(client, now)
    const active = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM demo_instances WHERE expires_at>$1', [now])
    if ((active.rows[0]?.count ?? 0) >= DEMO_LIMITS.activeInstances) throw new DemoCapacityError('Demo capacity is temporarily full')

    const instance = await client.query<{ id: string }>('INSERT INTO demo_instances(created_at,expires_at) VALUES ($1,$2) RETURNING id', [now, expiresAt])
    const instanceId = instance.rows[0]!.id
    const suffix = instanceId.replaceAll('-', '').slice(0, 16)
    const users: Array<{ id: string; name: string; email: string }> = []
    for (const [name, email] of [
      ['Demo Visitor', `visitor.${suffix}@demo.projectflow.invalid`],
      ['Alex Morgan', `alex.${suffix}@demo.projectflow.invalid`],
      ['Priya Shah', `priya.${suffix}@demo.projectflow.invalid`],
    ]) {
      const result = await client.query<{ id: string; name: string; email: string }>(
        'INSERT INTO users(name,email,password_hash,email_verified_at,demo_instance_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email',
        [name, email, DISABLED_PASSWORD_HASH, now, instanceId],
      )
      users.push(result.rows[0]!)
    }
    const [visitor, alex, priya] = users
    const workspace = await client.query<{ id: string }>(
      'INSERT INTO workspaces(name,created_by,created_at,demo_instance_id) VALUES ($1,$2,$3,$4) RETURNING id',
      ['Northstar Product Studio', visitor!.id, now, instanceId],
    )
    const workspaceId = workspace.rows[0]!.id
    for (const [user, role] of [[visitor, 'owner'], [alex, 'admin'], [priya, 'member']] as const) {
      await client.query('INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES ($1,$2,$3,$4)', [workspaceId, user!.id, role, now])
    }

    const projectDefinitions = [
      ['Website Launch', 'Coordinate the portfolio launch across design, engineering, and content.'],
      ['Client Portal', 'Deliver a secure client collaboration space with a focused beta scope.'],
      ['Brand Campaign', 'Prepare the messaging, assets, and rollout plan for the next campaign.'],
    ] as const
    const projects: Array<{ id: string; name: string }> = []
    for (const [name, description] of projectDefinitions) {
      const result = await client.query<{ id: string }>('INSERT INTO projects(workspace_id,name,description,created_at) VALUES ($1,$2,$3,$4) RETURNING id', [workspaceId, name, description, now])
      projects.push({ id: result.rows[0]!.id, name })
    }

    const taskDefinitions = [
      [0, 'Finalize responsive homepage', 'Review the last breakpoint and accessibility notes.', 'in_progress', 'high', 2, visitor!.id],
      [0, 'Publish launch checklist', 'Confirm owners and launch-day dependencies.', 'todo', 'high', 5, alex!.id],
      [0, 'Approve product screenshots', 'Select final desktop and mobile captures.', 'done', 'medium', -1, priya!.id],
      [0, 'Configure analytics events', 'Document the privacy-safe launch events.', 'done', 'low', -2, alex!.id],
      [1, 'Review authentication states', 'Check empty, error, loading, and expired-session states.', 'in_progress', 'high', 1, alex!.id],
      [1, 'Draft beta onboarding', 'Create a concise first-session checklist.', 'todo', 'medium', 4, priya!.id],
      [1, 'Validate workspace permissions', 'Exercise owner, admin, and member boundaries.', 'done', 'high', -3, visitor!.id],
      [1, 'Polish task detail panel', 'Tighten copy and keyboard focus behavior.', 'todo', 'medium', 6, visitor!.id],
      [2, 'Prepare campaign brief', 'Align audience, message, and success measures.', 'in_progress', 'medium', 3, priya!.id],
      [2, 'Schedule social assets', 'Sequence approved creative for launch week.', 'todo', 'low', 7, alex!.id],
      [2, 'Complete visual QA', 'Check contrast, spacing, and responsive crops.', 'done', 'medium', -1, priya!.id],
      [2, 'Collect stakeholder notes', 'Consolidate launch feedback into one decision log.', 'in_progress', 'low', 5, visitor!.id],
    ] as const
    const tasks: Array<{ id: string; title: string; projectId: string }> = []
    for (const [projectIndex, title, description, status, priority, dueOffset, assigneeId] of taskDefinitions) {
      const projectId = projects[projectIndex]!.id
      const result = await client.query<{ id: string }>(
        'INSERT INTO tasks(project_id,title,description,status,priority,assignee_id,due_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id',
        [projectId, title, description, status, priority, assigneeId, dateAfter(now, dueOffset), now],
      )
      tasks.push({ id: result.rows[0]!.id, title, projectId })
    }

    await client.query('INSERT INTO comments(task_id,author_id,body,created_at) VALUES ($1,$2,$3,$4),($5,$6,$7,$4)', [
      tasks[0]!.id, alex!.id, 'The tablet layout is ready. I left one note on the compact navigation.', now,
      tasks[4]!.id, priya!.id, 'Member and admin paths are covered; the owner pass is next.',
    ])
    const activity = [
      [tasks[0]!, visitor!.id, 'task.updated', { fields: ['status'], status: 'in_progress' }],
      [tasks[2]!, priya!.id, 'task.updated', { fields: ['status'], status: 'done' }],
      [tasks[4]!, alex!.id, 'comment.created', {}],
      [tasks[8]!, visitor!.id, 'task.created', { title: tasks[8]!.title }],
    ] as const
    for (const [task, actorId, action, metadata] of activity) {
      await client.query('INSERT INTO activity_events(workspace_id,project_id,task_id,actor_id,action,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)', [workspaceId, task.projectId, task.id, actorId, action, JSON.stringify(metadata), now])
    }

    await client.query('COMMIT')
    return {
      instanceId,
      workspaceId,
      expiresAt,
      user: {
        id: visitor!.id,
        name: visitor!.name,
        email: visitor!.email,
        email_verified: true,
        email_verification_required: true,
        demo: true,
        demo_expires_at: expiresAt.toISOString(),
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const countSql: Record<DemoResource, string> = {
  projects: 'SELECT count(*)::int AS count FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE w.demo_instance_id=$1',
  tasks: 'SELECT count(*)::int AS count FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id WHERE w.demo_instance_id=$1',
  comments: 'SELECT count(*)::int AS count FROM comments c JOIN tasks t ON t.id=c.task_id JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id WHERE w.demo_instance_id=$1',
  activity: 'SELECT count(*)::int AS count FROM activity_events a JOIN workspaces w ON w.id=a.workspace_id WHERE w.demo_instance_id=$1',
}

export async function withDemoQuota<T>(db: Pool, instanceId: string, resource: DemoResource, create: (client: PoolClient) => Promise<T>) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const active = await client.query('SELECT id FROM demo_instances WHERE id=$1 AND expires_at>now() FOR UPDATE', [instanceId])
    if (!active.rows.length) throw new DemoExpiredError('Demo session expired')
    const count = await client.query<{ count: number }>(countSql[resource], [instanceId])
    if ((count.rows[0]?.count ?? 0) >= DEMO_LIMITS[resource]) throw new DemoQuotaError(resource)
    const result = await create(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
