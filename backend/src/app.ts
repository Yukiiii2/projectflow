import argon2 from 'argon2';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { join } from 'node:path';
import session, { type Store } from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { z, ZodError } from 'zod';
import { recordActivity, registerCollaborationRoutes } from './collaboration.js';
import { previewInvitationDelivery, type InvitationDelivery } from './invitation-delivery.js';
import { createLogger, requestLogging, type Logger } from './logger.js';
import { activeAuthToken, authTokenOwner, issueAuthToken, issueAuthTokenInTransaction } from './auth-tokens.js';
import type { EmailOutbox } from './email-outbox.js';

declare module 'express-session' { interface SessionData { userId?: string; sessionVersion?: number } }
export interface AppConfig { frontendOrigin: string; sessionSecret: string; production: boolean; invitationTtlHours?: number; verificationTtlMinutes?: number; passwordResetTtlMinutes?: number; trustProxyHops?: number; requireEmailVerification?: boolean; recoveryResponseFloorMs?: number }
export interface AppOptions { db: Pool; sessionStore: Store; config: AppConfig; invitationDelivery?: InvitationDelivery; emailOutbox?: EmailOutbox; staticAssetsPath?: string; logger?: Logger }

const id = z.string().uuid();
const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Date must be a valid calendar date');
const signup = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();
const login = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
const emailOnly = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).strict();
const tokenOnly = z.object({ token: z.string().min(32).max(256) }).strict();
const passwordReset = z.object({ token: z.string().min(32).max(256), password: z.string().min(12).max(128) }).strict();
const workspaceSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const projectSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(5000).optional().default(''),
}).strict();
const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(5000).optional(),
  archived: z.literal(true).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'No fields provided');
const taskShape = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  dueDate: validDate.nullable(),
  assigneeId: id.nullable(),
};
const taskSchema = z.object({
  ...taskShape,
  description: taskShape.description.optional().default(''),
  status: taskShape.status.optional().default('todo'),
  priority: taskShape.priority.optional().default('medium'),
  dueDate: taskShape.dueDate.optional(),
  assigneeId: taskShape.assigneeId.optional(),
}).strict();
const taskUpdateSchema = z.object(taskShape).partial().strict();
const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
const malformedJson = (error: unknown): error is SyntaxError & { status: number; body: unknown } =>
  error instanceof SyntaxError && 'status' in error && error.status === 400 && 'body' in error;
const oversizedBody = (error: unknown): error is { status: number; type: string } =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 413 &&
  'type' in error && error.type === 'entity.too.large';

function dateOnly(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function normalizeProjectDate<T extends Record<string, unknown>>(row: T) {
  return { ...row, next_due_date: dateOnly(row.next_due_date) };
}

function normalizeTaskDate<T extends Record<string, unknown>>(row: T) {
  return { ...row, due_date: dateOnly(row.due_date) };
}

export function createApp({ db, sessionStore, config, invitationDelivery = previewInvitationDelivery(), emailOutbox, staticAssetsPath, logger = createLogger({ level: 'error' }) }: AppOptions) {
  if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  if (config.production && config.sessionSecret === 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS') {
    throw new Error('Production SESSION_SECRET must not use the example placeholder');
  }
  if (config.production && !config.frontendOrigin.startsWith('https://')) {
    throw new Error('Production FRONTEND_ORIGIN must use HTTPS');
  }
  const invitationTtlHours = config.invitationTtlHours ?? 168;
  const verificationTtlMinutes = config.verificationTtlMinutes ?? 1440;
  const passwordResetTtlMinutes = config.passwordResetTtlMinutes ?? 60;
  const recoveryResponseFloorMs = config.recoveryResponseFloorMs ?? (config.production ? 250 : 0);
  if (!Number.isFinite(invitationTtlHours) || invitationTtlHours < 1 || invitationTtlHours > 720) throw new Error('Invitation TTL must be between 1 and 720 hours');
  if (config.production && invitationDelivery.mode === 'preview') throw new Error('Production invitation delivery must use a configured email transport');
  const app = express();
  const sessionCookieName = config.production ? '__Host-projectflow.sid' : 'projectflow.sid';
  const cookie = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, maxAge: 604800000, path: '/', priority: 'high' as const };
  if (config.production) app.set('trust proxy', config.trustProxyHops ?? 1);
  app.disable('x-powered-by');
  app.use(requestLogging(logger));
  app.use(helmet({
    contentSecurityPolicy: config.production ? {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: [],
      },
    } : false,
    hsts: config.production ? { maxAge: 15_552_000 } : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  if (config.production) app.use((req, res, next) => {
    if (req.secure) { next(); return; }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const requestTarget = req.originalUrl.startsWith('/') ? req.originalUrl.replace(/^\/+/, '/') : `/${req.originalUrl}`;
      res.redirect(308, `${config.frontendOrigin}${requestTarget}`); return;
    }
    res.status(400).json({ error: 'HTTPS required' });
  });
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('origin') !== config.frontendOrigin || req.get('sec-fetch-site') === 'cross-site') {
        res.status(403).json({ error: 'Origin not allowed' }); return;
      }
    }
    next();
  });
  app.use(session({ name: sessionCookieName, store: sessionStore, secret: config.sessionSecret, resave: false, saveUninitialized: false, cookie }));
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => res.status(429).json({ error: 'Too many authentication attempts. Try again later.' }),
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many registration attempts. Try again later.' }),
  });
  const recoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many recovery attempts. Try again later.' }),
  });
  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId || req.session.sessionVersion === undefined) { res.status(401).json({ error: 'Sign in required' }); return; }
    void db.query<{ session_version: number; email_verified_at: string | null }>('SELECT session_version,email_verified_at FROM users WHERE id=$1', [req.session.userId])
      .then((result) => {
        const user = result.rows[0];
        if (!user || user.session_version !== req.session.sessionVersion) {
          req.session.destroy(() => undefined);
          res.status(401).json({ error: 'Sign in required' }); return;
        }
        res.locals.sessionUser = user;
        next();
      })
      .catch(next);
  };
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    requireSession(req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      const user = res.locals.sessionUser as { email_verified_at: string | null };
      if (config.requireEmailVerification && !user.email_verified_at) {
        res.status(403).json({ error: 'Email verification required', code: 'EMAIL_VERIFICATION_REQUIRED' }); return;
      }
      next();
    });
  };
  async function membership(userId: string, workspaceId: string) {
    const result = await db.query<{ role: string }>('SELECT role FROM workspace_members WHERE user_id=$1 AND workspace_id=$2', [userId, workspaceId]);
    return result.rows[0]?.role;
  }
  async function projectAccess(userId: string, projectId: string) {
    const result = await db.query<{ workspace_id: string; role: string }>('SELECT p.workspace_id,m.role FROM projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id AND m.user_id=$1 WHERE p.id=$2 AND p.archived_at IS NULL', [userId, projectId]);
    return result.rows[0];
  }
  const projectSummarySql = `SELECT p.id,p.workspace_id,p.name,p.description,p.created_at,p.archived_at,
    COUNT(t.id)::int AS task_count,
    COALESCE(SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END),0)::int AS completed_task_count,
    MIN(CASE WHEN t.status<>'done' THEN t.due_date ELSE NULL END) AS next_due_date
    FROM projects p LEFT JOIN tasks t ON t.project_id=p.id`;
  const projectSummaryGroup = 'GROUP BY p.id,p.workspace_id,p.name,p.description,p.created_at,p.archived_at';
  const taskDetailSql = `SELECT t.id,t.project_id,p.workspace_id,p.name AS project_name,t.title,t.description,t.status,t.priority,
    t.due_date,t.assignee_id,u.name AS assignee_name,u.email AS assignee_email,t.created_at,t.updated_at
    FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assignee_id`;
  async function projectSummary(projectId: string) {
    const result = await db.query(`${projectSummarySql} WHERE p.id=$1 AND p.archived_at IS NULL ${projectSummaryGroup}`, [projectId]);
    return result.rows[0] ? normalizeProjectDate(result.rows[0]) : undefined;
  }
  async function taskDetail(taskId: string) {
    const result = await db.query(`${taskDetailSql} WHERE t.id=$1 AND p.archived_at IS NULL`, [taskId]);
    return result.rows[0] ? normalizeTaskDate(result.rows[0]) : undefined;
  }
  async function validAssignee(workspaceId: string, assigneeId: string | null | undefined) {
    if (assigneeId === undefined || assigneeId === null) return true;
    return Boolean(await membership(assigneeId, workspaceId));
  }

  app.get('/api/health', wrap(async (_req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); }));
  app.post('/api/auth/register', registrationLimiter, wrap(async (req, res) => {
    const body = signup.parse(req.body);
    const hash = await argon2.hash(body.password, { type: argon2.argon2id });
    const client = await db.connect();
    let createdUser: { id: string; name: string; email: string; session_version: number; email_verified_at: string | null };
    let verification: { token: string; expiresAt: Date };
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string; name: string; email: string; session_version: number; email_verified_at: string | null }>('INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,session_version,email_verified_at', [body.name, body.email, hash]);
      createdUser = created.rows[0]!;
      verification = await issueAuthTokenInTransaction(client, createdUser.id, 'email_verification', verificationTtlMinutes);
      if (emailOutbox) await emailOutbox.enqueue(client, 'email_verification', { recipient: createdUser.email, name: createdUser.name, expiresAt: verification.expiresAt.toISOString(), verifyUrl: `${config.frontendOrigin}/verify-email?token=${encodeURIComponent(verification.token)}` });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the source error */ }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        res.status(409).json({ error: 'Email is already registered' }); return;
      }
      throw error;
    } finally {
      client.release();
    }
    let verificationDelivery;
    if (emailOutbox) verificationDelivery = { status: 'queued' as const };
    else try {
      verificationDelivery = await invitationDelivery.sendVerification({ recipient: createdUser.email, name: createdUser.name, expiresAt: verification.expiresAt.toISOString(), verifyUrl: `${config.frontendOrigin}/verify-email?token=${encodeURIComponent(verification.token)}` });
    } catch (error) {
      logger.warn('email_delivery_failed', { purpose: 'email_verification', errorName: error instanceof Error ? error.name : 'UnknownError' });
      verificationDelivery = { status: 'failed' };
    }
    req.session.regenerate((error) => {
      if (error) { res.status(500).json({ error: 'Session initialization failed' }); return; }
      req.session.userId = createdUser.id;
      req.session.sessionVersion = createdUser.session_version;
      const user = { id: createdUser.id, name: createdUser.name, email: createdUser.email, email_verified: Boolean(createdUser.email_verified_at), email_verification_required: Boolean(config.requireEmailVerification) };
      req.session.save((saveError) => saveError ? res.status(500).json({ error: 'Session save failed' }) : res.status(201).json({ user, verification_delivery: verificationDelivery }));
    });
  }));
  app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
    const body = login.parse(req.body);
    const result = await db.query<{ id: string; name: string; email: string; password_hash: string; session_version: number; email_verified_at: string | null }>('SELECT id,name,email,password_hash,session_version,email_verified_at FROM users WHERE email=$1', [body.email]);
    const user = result.rows[0];
    if (!user || !(await argon2.verify(user.password_hash, body.password))) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    req.session.regenerate((error) => {
      if (error) { res.status(500).json({ error: 'Session initialization failed' }); return; }
      req.session.userId = user.id;
      req.session.sessionVersion = user.session_version;
      req.session.save((saveError) => saveError ? res.status(500).json({ error: 'Session save failed' }) : res.json({ user: { id: user.id, name: user.name, email: user.email, email_verified: Boolean(user.email_verified_at), email_verification_required: Boolean(config.requireEmailVerification) } }));
    });
  }));
  app.post('/api/auth/logout', requireSession, (req, res, next) => req.session.destroy((error) => {
    if (error) { next(error); return; }
    res.clearCookie(sessionCookieName, { httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path });
    res.status(204).end();
  }));
  app.get('/api/auth/me', requireSession, wrap(async (req, res) => {
    const result = await db.query<{ id: string; name: string; email: string; created_at: string; email_verified_at: string | null }>('SELECT id,name,email,created_at,email_verified_at FROM users WHERE id=$1', [req.session.userId]);
    if (!result.rows[0]) { res.status(401).json({ error: 'Sign in required' }); return; }
    const user = result.rows[0];
    res.json({ user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at, email_verified: Boolean(user.email_verified_at), email_verification_required: Boolean(config.requireEmailVerification) } });
  }));
  app.post('/api/auth/email-verification/request', requireSession, recoveryLimiter, wrap(async (req, res) => {
    const result = await db.query<{ id: string; name: string; email: string; email_verified_at: string | null }>('SELECT id,name,email,email_verified_at FROM users WHERE id=$1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) { res.status(401).json({ error: 'Sign in required' }); return; }
    if (user.email_verified_at) { res.status(204).end(); return; }
    const issued = await issueAuthToken(db, user.id, 'email_verification', verificationTtlMinutes, emailOutbox ? async (client, token) => {
      await emailOutbox.enqueue(client, 'email_verification', { recipient: user.email, name: user.name, expiresAt: token.expiresAt.toISOString(), verifyUrl: `${config.frontendOrigin}/verify-email?token=${encodeURIComponent(token.token)}` });
    } : undefined);
    const delivery = emailOutbox ? { status: 'queued' as const } : await invitationDelivery.sendVerification({ recipient: user.email, name: user.name, expiresAt: issued.expiresAt.toISOString(), verifyUrl: `${config.frontendOrigin}/verify-email?token=${encodeURIComponent(issued.token)}` });
    res.status(202).json({ message: 'Verification email requested.', delivery: config.production ? { status: delivery.status } : delivery });
  }));
  app.post('/api/auth/email-verification/confirm', recoveryLimiter, wrap(async (req, res) => {
    const { token } = tokenOnly.parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owner = await authTokenOwner(client, token, 'email_verification');
      if (!owner) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Verification link is invalid or expired' }); return; }
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner.user_id]);
      const record = await activeAuthToken(client, token, 'email_verification');
      if (!record) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Verification link is invalid or expired' }); return; }
      await client.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1', [record.user_id]);
      await client.query('UPDATE auth_tokens SET consumed_at=now() WHERE id=$1', [record.id]);
      await client.query('COMMIT');
      res.json({ message: 'Email verified.' });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.post('/api/auth/password-reset/request', recoveryLimiter, wrap(async (req, res) => {
    const responseStartedAt = Date.now();
    const { email } = emailOnly.parse(req.body);
    const result = await db.query<{ id: string; name: string; email: string }>('SELECT id,name,email FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (user) {
      try {
        const issued = await issueAuthToken(db, user.id, 'password_reset', passwordResetTtlMinutes, emailOutbox ? async (client, token) => {
          await emailOutbox.enqueue(client, 'password_reset', { recipient: user.email, name: user.name, expiresAt: token.expiresAt.toISOString(), resetUrl: `${config.frontendOrigin}/reset-password?token=${encodeURIComponent(token.token)}` });
        } : undefined);
        if (!emailOutbox) await invitationDelivery.sendPasswordReset({ recipient: user.email, name: user.name, expiresAt: issued.expiresAt.toISOString(), resetUrl: `${config.frontendOrigin}/reset-password?token=${encodeURIComponent(issued.token)}` });
      } catch (error) {
        logger.warn('email_delivery_failed', { purpose: 'password_reset', errorName: error instanceof Error ? error.name : 'UnknownError' });
      }
    }
    const remainingDelay = recoveryResponseFloorMs - (Date.now() - responseStartedAt);
    if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    res.status(202).json({ message: 'If an account matches that email, a reset link has been sent.' });
  }));
  app.post('/api/auth/password-reset/confirm', recoveryLimiter, wrap(async (req, res) => {
    const body = passwordReset.parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owner = await authTokenOwner(client, body.token, 'password_reset');
      if (!owner) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Password reset link is invalid or expired' }); return; }
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner.user_id]);
      const record = await activeAuthToken(client, body.token, 'password_reset');
      if (!record) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Password reset link is invalid or expired' }); return; }
      const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
      await client.query('UPDATE users SET password_hash=$1,session_version=session_version+1 WHERE id=$2', [passwordHash, record.user_id]);
      await client.query('UPDATE auth_tokens SET consumed_at=now() WHERE id=$1', [record.id]);
      await client.query("UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [record.user_id]);
      await client.query('COMMIT');
      res.status(204).end();
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.get('/api/workspaces', requireUser, wrap(async (req, res) => {
    const result = await db.query('SELECT w.id,w.name,m.role,w.created_at FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at DESC', [req.session.userId]);
    res.json({ workspaces: result.rows });
  }));
  app.post('/api/workspaces', requireUser, wrap(async (req, res) => {
    const { name } = workspaceSchema.parse(req.body); const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; name: string; created_at: string }>('INSERT INTO workspaces(name,created_by) VALUES ($1,$2) RETURNING id,name,created_at', [name, req.session.userId]);
      await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [result.rows[0]!.id, req.session.userId, 'owner']);
      await client.query('COMMIT'); res.status(201).json({ workspace: { ...result.rows[0], role: 'owner' } });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.get('/api/workspaces/:wid/projects', requireUser, wrap(async (req, res) => {
    const workspaceId = id.parse(req.params.wid);
    if (!(await membership(req.session.userId!, workspaceId))) { res.status(404).json({ error: 'Workspace not found' }); return; }
    const result = await db.query(`${projectSummarySql} WHERE p.workspace_id=$1 AND p.archived_at IS NULL ${projectSummaryGroup} ORDER BY p.created_at DESC`, [workspaceId]);
    res.json({ projects: result.rows.map(normalizeProjectDate) });
  }));
  app.get('/api/workspaces/:wid/tasks', requireUser, wrap(async (req, res) => {
    const workspaceId = id.parse(req.params.wid);
    if (!(await membership(req.session.userId!, workspaceId))) { res.status(404).json({ error: 'Workspace not found' }); return; }
    const result = await db.query(`${taskDetailSql} WHERE p.workspace_id=$1 AND p.archived_at IS NULL ORDER BY t.created_at DESC`, [workspaceId]);
    res.json({ tasks: result.rows.map(normalizeTaskDate) });
  }));
  app.get('/api/workspaces/:wid/members', requireUser, wrap(async (req, res) => {
    const workspaceId = id.parse(req.params.wid);
    if (!(await membership(req.session.userId!, workspaceId))) { res.status(404).json({ error: 'Workspace not found' }); return; }
    const result = await db.query('SELECT u.id,u.name,u.email,m.role,m.joined_at FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END,u.name', [workspaceId]);
    res.json({ members: result.rows });
  }));
  app.post('/api/workspaces/:wid/projects', requireUser, wrap(async (req, res) => {
    const workspaceId = id.parse(req.params.wid); const role = await membership(req.session.userId!, workspaceId);
    if (!role) { res.status(404).json({ error: 'Workspace not found' }); return; }
    if (!['owner', 'admin'].includes(role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
    const body = projectSchema.parse(req.body);
    const result = await db.query<{ id: string }>('INSERT INTO projects(workspace_id,name,description) VALUES ($1,$2,$3) RETURNING id', [workspaceId, body.name, body.description]);
    res.status(201).json({ project: await projectSummary(result.rows[0]!.id) });
  }));
  app.get('/api/projects/:pid', requireUser, wrap(async (req, res) => {
    const projectId = id.parse(req.params.pid);
    if (!(await projectAccess(req.session.userId!, projectId))) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ project: await projectSummary(projectId) });
  }));
  app.patch('/api/projects/:pid', requireUser, wrap(async (req, res) => {
    const projectId = id.parse(req.params.pid); const access = await projectAccess(req.session.userId!, projectId);
    if (!access) { res.status(404).json({ error: 'Project not found' }); return; }
    if (!['owner', 'admin'].includes(access.role)) { res.status(403).json({ error: 'Insufficient permissions' }); return; }
    const updates = projectUpdateSchema.parse(req.body);
    if (updates.archived) {
      const result = await db.query('UPDATE projects SET archived_at=now() WHERE id=$1 RETURNING id,workspace_id,name,description,created_at,archived_at', [projectId]);
      res.json({ project: result.rows[0] }); return;
    }
    const columns: Record<string, string> = { name: 'name', description: 'description' };
    const parameters: unknown[] = [projectId];
    const assignments = Object.entries(updates).filter(([key]) => key !== 'archived').map(([key, value]) => {
      parameters.push(value); return `${columns[key]}=$${parameters.length}`;
    });
    await db.query(`UPDATE projects SET ${assignments.join(',')} WHERE id=$1`, parameters);
    res.json({ project: await projectSummary(projectId) });
  }));
  app.get('/api/projects/:pid/tasks', requireUser, wrap(async (req, res) => {
    const projectId = id.parse(req.params.pid);
    if (!(await projectAccess(req.session.userId!, projectId))) { res.status(404).json({ error: 'Project not found' }); return; }
    const result = await db.query(`${taskDetailSql} WHERE t.project_id=$1 AND p.archived_at IS NULL ORDER BY t.created_at DESC`, [projectId]);
    res.json({ tasks: result.rows.map(normalizeTaskDate) });
  }));
  app.post('/api/projects/:pid/tasks', requireUser, wrap(async (req, res) => {
    const projectId = id.parse(req.params.pid); const access = await projectAccess(req.session.userId!, projectId);
    if (!access) { res.status(404).json({ error: 'Project not found' }); return; }
    const body = taskSchema.parse(req.body);
    if (!(await validAssignee(access.workspace_id, body.assigneeId))) { res.status(400).json({ error: 'Assignee must be a workspace member' }); return; }
    const result = await db.query<{ id: string }>('INSERT INTO tasks(project_id,title,description,status,priority,due_date,assignee_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [projectId, body.title, body.description, body.status, body.priority, body.dueDate ?? null, body.assigneeId ?? null]);
    const createdTask = await taskDetail(result.rows[0]!.id);
    await recordActivity(db, { workspaceId: access.workspace_id, projectId, taskId: result.rows[0]!.id, actorId: req.session.userId!, action: 'task.created', metadata: { title: body.title } });
    res.status(201).json({ task: createdTask });
  }));
  app.patch('/api/tasks/:tid', requireUser, wrap(async (req, res) => {
    const taskId = id.parse(req.params.tid); const task = await db.query<{ project_id: string; status: string; priority: string; assignee_id: string | null }>('SELECT project_id,status,priority,assignee_id FROM tasks WHERE id=$1', [taskId]);
    const access = task.rows[0] ? await projectAccess(req.session.userId!, task.rows[0].project_id) : undefined;
    if (!task.rows[0] || !access) { res.status(404).json({ error: 'Task not found' }); return; }
    const updates = taskUpdateSchema.parse(req.body);
    if (!Object.keys(updates).length) { res.status(400).json({ error: 'No fields provided' }); return; }
    if (!(await validAssignee(access.workspace_id, updates.assigneeId))) { res.status(400).json({ error: 'Assignee must be a workspace member' }); return; }
    const columns: Record<string, string> = { title: 'title', description: 'description', status: 'status', priority: 'priority', dueDate: 'due_date', assigneeId: 'assignee_id' };
    const parameters: unknown[] = [taskId];
    const assignments = Object.entries(updates).map(([key, value]) => { parameters.push(value); return `${columns[key]}=$${parameters.length}`; });
    await db.query(`UPDATE tasks SET ${assignments.join(',')},updated_at=now() WHERE id=$1`, parameters);
    const updatedTask = await taskDetail(taskId);
    await recordActivity(db, { workspaceId: access.workspace_id, projectId: task.rows[0]!.project_id, taskId, actorId: req.session.userId!, action: 'task.updated', metadata: { fields: Object.keys(updates), status: updatedTask?.status, priority: updatedTask?.priority, assigneeId: updatedTask?.assignee_id } });
    res.json({ task: updatedTask });
  }));
  registerCollaborationRoutes(app, { db, requireUser, wrap, membership, projectAccess, delivery: invitationDelivery, emailOutbox, frontendOrigin: config.frontendOrigin, invitationTtlHours });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route not found' }));
  if (staticAssetsPath) {
    app.use(express.static(staticAssetsPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${join('assets', '')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(staticAssetsPath, 'index.html'));
    });
  } else {
    app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid request', details: z.flattenError(error) }); return; }
    if (malformedJson(error)) { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    if (oversizedBody(error)) { res.status(413).json({ error: 'Request body is too large' }); return; }
    logger.error('request_failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
