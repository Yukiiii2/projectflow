import { createHash, randomBytes } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { InvitationDelivery } from './invitation-delivery.js'

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>
type Membership = (userId: string, workspaceId: string) => Promise<string | undefined>
type ProjectAccess = (userId: string, projectId: string) => Promise<{ workspace_id: string; role: string } | undefined>

interface CollaborationOptions {
  db: Pool
  requireUser: (req: Request, res: Response, next: NextFunction) => void
  wrap: (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => void
  membership: Membership
  projectAccess: ProjectAccess
  delivery: InvitationDelivery
  frontendOrigin: string
  invitationTtlHours: number
}

const uuid = z.string().uuid()
const invitationInput = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(['admin', 'member']).default('member'),
}).strict()
const roleInput = z.object({ role: z.enum(['admin', 'member']) }).strict()
const commentInput = z.object({ body: z.string().trim().min(1).max(5000) }).strict()

const invitationStatusSql = `CASE
  WHEN i.accepted_at IS NOT NULL THEN 'accepted'
  WHEN i.revoked_at IS NOT NULL THEN 'revoked'
  WHEN i.expires_at <= now() THEN 'expired'
  ELSE 'pending' END`

export async function recordActivity(db: Pool, input: {
  workspaceId: string
  projectId?: string | null
  taskId?: string | null
  actorId: string
  action: string
  metadata?: Record<string, unknown>
}) {
  await db.query(
    'INSERT INTO activity_events(workspace_id,project_id,task_id,actor_id,action,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
    [input.workspaceId, input.projectId ?? null, input.taskId ?? null, input.actorId, input.action, JSON.stringify(input.metadata ?? {})],
  )
}

export function registerCollaborationRoutes(app: Express, options: CollaborationOptions) {
  const { db, requireUser, wrap, membership, projectAccess, delivery, frontendOrigin, invitationTtlHours } = options

  async function actorRole(req: Request, res: Response, workspaceId: string) {
    const role = await membership(req.session.userId!, workspaceId)
    if (!role) { res.status(404).json({ error: 'Workspace not found' }); return undefined }
    return role
  }

  app.get('/api/workspaces/:wid/invitations', requireUser, wrap(async (req, res) => {
    const workspaceId = uuid.parse(req.params.wid)
    const role = await actorRole(req, res, workspaceId)
    if (!role) return
    if (!['owner', 'admin'].includes(role)) { res.status(403).json({ error: 'Insufficient permissions' }); return }
    const result = await db.query(`SELECT i.id,i.workspace_id,i.email,i.role,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,
      ${invitationStatusSql} AS status,u.id AS invited_by_id,u.name AS invited_by_name
      FROM workspace_invitations i JOIN users u ON u.id=i.invited_by
      WHERE i.workspace_id=$1 ORDER BY i.created_at DESC`, [workspaceId])
    res.json({ invitations: result.rows })
  }))

  app.post('/api/workspaces/:wid/invitations', requireUser, wrap(async (req, res) => {
    const workspaceId = uuid.parse(req.params.wid)
    const actor = await actorRole(req, res, workspaceId)
    if (!actor) return
    if (!['owner', 'admin'].includes(actor)) { res.status(403).json({ error: 'Insufficient permissions' }); return }
    const body = invitationInput.parse(req.body)
    if (actor === 'admin' && body.role !== 'member') { res.status(403).json({ error: 'Admins can invite members only' }); return }
    const existing = await db.query('SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=$2', [workspaceId, body.email])
    if (existing.rows.length) { res.status(409).json({ error: 'This person is already a workspace member' }); return }
    await db.query('UPDATE workspace_invitations SET revoked_at=now() WHERE workspace_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()', [workspaceId, body.email])
    const pending = await db.query('SELECT 1 FROM workspace_invitations WHERE workspace_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()', [workspaceId, body.email])
    if (pending.rows.length) { res.status(409).json({ error: 'A pending invitation already exists for this email' }); return }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + invitationTtlHours * 60 * 60 * 1000)
    const created = await db.query<{ id: string }>('INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [workspaceId, body.email, body.role, tokenHash, req.session.userId, expiresAt])
    const details = await db.query(`SELECT i.id,i.workspace_id,i.email,i.role,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,
      ${invitationStatusSql} AS status,u.id AS invited_by_id,u.name AS invited_by_name,w.name AS workspace_name
      FROM workspace_invitations i JOIN users u ON u.id=i.invited_by JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=$1`, [created.rows[0]!.id])
    const invitation = details.rows[0]!
    try {
      const deliveryResult = await delivery.send({
        recipient: body.email,
        inviterName: String(invitation.invited_by_name),
        workspaceName: String(invitation.workspace_name),
        role: body.role,
        expiresAt: expiresAt.toISOString(),
        acceptUrl: `${frontendOrigin}/invite/${token}`,
      })
      const { workspace_name: _workspaceName, ...safeInvitation } = invitation
      res.status(201).json({ invitation: safeInvitation, delivery: deliveryResult })
    } catch {
      await db.query('UPDATE workspace_invitations SET revoked_at=now() WHERE id=$1', [created.rows[0]!.id])
      res.status(502).json({ error: 'Invitation delivery failed. No active invitation was created.' })
    }
  }))

  app.delete('/api/workspaces/:wid/invitations/:iid', requireUser, wrap(async (req, res) => {
    const workspaceId = uuid.parse(req.params.wid); const invitationId = uuid.parse(req.params.iid)
    const actor = await actorRole(req, res, workspaceId)
    if (!actor) return
    if (!['owner', 'admin'].includes(actor)) { res.status(403).json({ error: 'Insufficient permissions' }); return }
    const found = await db.query<{ role: string; accepted_at: string | null; revoked_at: string | null }>('SELECT role,accepted_at,revoked_at FROM workspace_invitations WHERE id=$1 AND workspace_id=$2', [invitationId, workspaceId])
    if (!found.rows[0]) { res.status(404).json({ error: 'Invitation not found' }); return }
    if (actor === 'admin' && found.rows[0].role !== 'member') { res.status(403).json({ error: 'Admins can revoke member invitations only' }); return }
    if (found.rows[0].accepted_at || found.rows[0].revoked_at) { res.status(409).json({ error: 'Invitation is no longer pending' }); return }
    await db.query('UPDATE workspace_invitations SET revoked_at=now() WHERE id=$1', [invitationId])
    const updated = await db.query(`SELECT i.id,i.workspace_id,i.email,i.role,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,${invitationStatusSql} AS status,u.id AS invited_by_id,u.name AS invited_by_name FROM workspace_invitations i JOIN users u ON u.id=i.invited_by WHERE i.id=$1`, [invitationId])
    res.json({ invitation: updated.rows[0] })
  }))

  app.get('/api/invitations/:token', wrap(async (req, res) => {
    const tokenHash = createHash('sha256').update(String(req.params.token)).digest('hex')
    const result = await db.query(`SELECT i.email,i.role,i.expires_at,${invitationStatusSql} AS status,w.name AS workspace_name,u.name AS invited_by_name FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id JOIN users u ON u.id=i.invited_by WHERE i.token_hash=$1`, [tokenHash])
    if (!result.rows[0]) { res.status(404).json({ error: 'Invitation not found' }); return }
    res.json({ invitation: result.rows[0] })
  }))

  app.post('/api/invitations/:token/accept', requireUser, wrap(async (req, res) => {
    const tokenHash = createHash('sha256').update(String(req.params.token)).digest('hex')
    const invitationResult = await db.query<{ id: string; workspace_id: string; email: string; role: 'admin' | 'member'; status: string }>(`SELECT i.id,i.workspace_id,i.email,i.role,${invitationStatusSql} AS status FROM workspace_invitations i WHERE i.token_hash=$1`, [tokenHash])
    const invitation = invitationResult.rows[0]
    if (!invitation) { res.status(404).json({ error: 'Invitation not found' }); return }
    if (invitation.status !== 'pending') { res.status(409).json({ error: `Invitation is ${invitation.status}` }); return }
    const user = await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [req.session.userId])
    if (user.rows[0]?.email !== invitation.email) { res.status(403).json({ error: 'Invitation email does not match your account' }); return }
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const claimed = await client.query('UPDATE workspace_invitations SET accepted_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id', [invitation.id])
      if (!claimed.rows.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Invitation is no longer pending' }); return }
      const existing = await client.query('SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [invitation.workspace_id, req.session.userId])
      if (existing.rows.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'You are already a workspace member' }); return }
      await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [invitation.workspace_id, req.session.userId, invitation.role])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    await recordActivity(db, { workspaceId: invitation.workspace_id, actorId: req.session.userId!, action: 'member.joined', metadata: { role: invitation.role } })
    const workspace = await db.query('SELECT w.id,w.name,m.role,w.created_at FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2', [invitation.workspace_id, req.session.userId])
    res.json({ workspace: workspace.rows[0] })
  }))

  app.patch('/api/workspaces/:wid/members/:uid', requireUser, wrap(async (req, res) => {
    const workspaceId = uuid.parse(req.params.wid); const targetId = uuid.parse(req.params.uid)
    const actor = await actorRole(req, res, workspaceId)
    if (!actor) return
    if (actor !== 'owner') { res.status(403).json({ error: 'Only workspace owners can change roles' }); return }
    const body = roleInput.parse(req.body)
    const target = await db.query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetId])
    if (!target.rows[0]) { res.status(404).json({ error: 'Workspace member not found' }); return }
    if (target.rows[0].role === 'owner') { res.status(400).json({ error: 'Workspace ownership cannot be changed' }); return }
    await db.query('UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetId, body.role])
    const updated = await db.query('SELECT u.id,u.name,u.email,m.role,m.joined_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2', [workspaceId, targetId])
    await recordActivity(db, { workspaceId, actorId: req.session.userId!, action: 'member.role_changed', metadata: { memberId: targetId, role: body.role } })
    res.json({ member: updated.rows[0] })
  }))

  app.delete('/api/workspaces/:wid/members/:uid', requireUser, wrap(async (req, res) => {
    const workspaceId = uuid.parse(req.params.wid); const targetId = uuid.parse(req.params.uid)
    const actor = await actorRole(req, res, workspaceId)
    if (!actor) return
    if (!['owner', 'admin'].includes(actor)) { res.status(403).json({ error: 'Insufficient permissions' }); return }
    if (targetId === req.session.userId) { res.status(400).json({ error: 'You cannot remove yourself' }); return }
    const target = await db.query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetId])
    if (!target.rows[0]) { res.status(404).json({ error: 'Workspace member not found' }); return }
    if (target.rows[0].role === 'owner') { res.status(400).json({ error: 'The workspace owner cannot be removed' }); return }
    if (actor === 'admin' && target.rows[0].role !== 'member') { res.status(403).json({ error: 'Admins can remove members only' }); return }
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE tasks SET assignee_id=NULL,updated_at=now() WHERE assignee_id=$1 AND project_id IN (SELECT id FROM projects WHERE workspace_id=$2)', [targetId, workspaceId])
      await client.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, targetId])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    await recordActivity(db, { workspaceId, actorId: req.session.userId!, action: 'member.removed', metadata: { memberId: targetId } })
    res.json({ removed: true })
  }))

  app.get('/api/tasks/:tid/comments', requireUser, wrap(async (req, res) => {
    const taskId = uuid.parse(req.params.tid)
    const task = await db.query<{ project_id: string }>('SELECT project_id FROM tasks WHERE id=$1', [taskId])
    const access = task.rows[0] ? await projectAccess(req.session.userId!, task.rows[0].project_id) : undefined
    if (!task.rows[0] || !access) { res.status(404).json({ error: 'Task not found' }); return }
    const result = await db.query(`SELECT c.id,c.task_id,c.body,c.created_at,c.edited_at,u.id AS author_id,u.name AS author_name,u.email AS author_email,
      (c.author_id=$2) AS can_edit,(c.author_id=$2 OR $3 IN ('owner','admin')) AS can_delete
      FROM comments c JOIN users u ON u.id=c.author_id WHERE c.task_id=$1 ORDER BY c.created_at`, [taskId, req.session.userId, access.role])
    res.json({ comments: result.rows })
  }))

  app.post('/api/tasks/:tid/comments', requireUser, wrap(async (req, res) => {
    const taskId = uuid.parse(req.params.tid)
    const task = await db.query<{ project_id: string }>('SELECT project_id FROM tasks WHERE id=$1', [taskId])
    const access = task.rows[0] ? await projectAccess(req.session.userId!, task.rows[0].project_id) : undefined
    if (!task.rows[0] || !access) { res.status(404).json({ error: 'Task not found' }); return }
    const { body } = commentInput.parse(req.body)
    const created = await db.query<{ id: string }>('INSERT INTO comments(task_id,author_id,body) VALUES ($1,$2,$3) RETURNING id', [taskId, req.session.userId, body])
    await recordActivity(db, { workspaceId: access.workspace_id, projectId: task.rows[0].project_id, taskId, actorId: req.session.userId!, action: 'comment.created' })
    const result = await db.query(`SELECT c.id,c.task_id,c.body,c.created_at,c.edited_at,u.id AS author_id,u.name AS author_name,u.email AS author_email,true AS can_edit,true AS can_delete FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=$1`, [created.rows[0]!.id])
    res.status(201).json({ comment: result.rows[0] })
  }))

  async function commentAccess(userId: string, commentId: string) {
    const result = await db.query<{ id: string; task_id: string; project_id: string; workspace_id: string; author_id: string; role: string }>(`SELECT c.id,c.task_id,t.project_id,p.workspace_id,c.author_id,m.role FROM comments c JOIN tasks t ON t.id=c.task_id JOIN projects p ON p.id=t.project_id JOIN workspace_members m ON m.workspace_id=p.workspace_id AND m.user_id=$1 WHERE c.id=$2 AND p.archived_at IS NULL`, [userId, commentId])
    return result.rows[0]
  }

  app.patch('/api/comments/:cid', requireUser, wrap(async (req, res) => {
    const commentId = uuid.parse(req.params.cid); const access = await commentAccess(req.session.userId!, commentId)
    if (!access) { res.status(404).json({ error: 'Comment not found' }); return }
    if (access.author_id !== req.session.userId) { res.status(403).json({ error: 'Only the comment author can edit it' }); return }
    const { body } = commentInput.parse(req.body)
    await db.query('UPDATE comments SET body=$2,edited_at=now() WHERE id=$1', [commentId, body])
    await recordActivity(db, { workspaceId: access.workspace_id, projectId: access.project_id, taskId: access.task_id, actorId: req.session.userId!, action: 'comment.edited' })
    const result = await db.query(`SELECT c.id,c.task_id,c.body,c.created_at,c.edited_at,u.id AS author_id,u.name AS author_name,u.email AS author_email,true AS can_edit,true AS can_delete FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=$1`, [commentId])
    res.json({ comment: result.rows[0] })
  }))

  app.delete('/api/comments/:cid', requireUser, wrap(async (req, res) => {
    const commentId = uuid.parse(req.params.cid); const access = await commentAccess(req.session.userId!, commentId)
    if (!access) { res.status(404).json({ error: 'Comment not found' }); return }
    if (access.author_id !== req.session.userId && !['owner', 'admin'].includes(access.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return }
    await db.query('DELETE FROM comments WHERE id=$1', [commentId])
    await recordActivity(db, { workspaceId: access.workspace_id, projectId: access.project_id, taskId: access.task_id, actorId: req.session.userId!, action: 'comment.deleted' })
    res.status(204).end()
  }))

  app.get('/api/tasks/:tid/activity', requireUser, wrap(async (req, res) => {
    const taskId = uuid.parse(req.params.tid)
    const task = await db.query<{ project_id: string }>('SELECT project_id FROM tasks WHERE id=$1', [taskId])
    if (!task.rows[0] || !(await projectAccess(req.session.userId!, task.rows[0].project_id))) { res.status(404).json({ error: 'Task not found' }); return }
    const result = await db.query(`SELECT a.id,a.action,a.metadata,a.created_at,u.id AS actor_id,u.name AS actor_name FROM activity_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.task_id=$1 ORDER BY a.created_at DESC LIMIT 50`, [taskId])
    res.json({ activity: result.rows })
  }))
}
