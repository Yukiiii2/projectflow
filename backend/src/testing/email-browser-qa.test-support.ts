import { createHash, randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import session from 'express-session'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { Pool } from 'pg'
import dotenv from 'dotenv'
import { createApp } from '../app.js'
import { hashAuthToken } from '../auth-tokens.js'
import { createEmailOutbox, processNextOutboxMessage } from '../email-outbox.js'
import { createLogger } from '../logger.js'
import { CapturingEmailDelivery } from './email-capture.test-support.js'
import { createIsolatedEmailQaDatabase, tokenFromCapturedUrl, type IsolatedEmailQaDatabase } from './email-browser-helpers.test-support.js'

interface ApiResult { status: number; body: unknown; text: string }
interface Account { name: string; email: string }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function reserveLoopbackPort() {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  assert(address && typeof address === 'object', 'Could not reserve a loopback port')
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function browserApi(page: Page, pathname: string, init: { method?: string; body?: string } = {}): Promise<ApiResult> {
  return page.evaluate(async ({ path, request }) => {
    const response = await fetch(path, {
      ...request,
      credentials: 'include',
      headers: request.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    const text = response.status === 204 ? '' : await response.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { status: response.status, body, text }
  }, { path: pathname, request: init })
}

async function register(page: Page, account: Account, password: string) {
  await page.goto('/register', { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(account.name)
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Verify your email' }).waitFor()
}

async function verifyCapturedEmail(page: Page, verifyUrl: string) {
  await page.goto(verifyUrl, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Verify email' }).click()
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
}

async function requestPasswordReset(page: Page) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/password-reset/request'
  ))
  await page.getByRole('button', { name: 'Send reset link' }).click()
  const response = await responsePromise
  assert(response.status() === 202, `Password reset request returned HTTP ${response.status()}`)
}

function monitor(page: Page, origin: string, apiBodies: string[], consoleMessages: string[], browserErrors: string[]) {
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    const text = message.text()
    consoleMessages.push(text)
    if (message.type() === 'error' && !text.startsWith('Failed to load resource:')) browserErrors.push(`console: ${text}`)
  })
  page.on('response', (response) => {
    const isApi = response.url().startsWith(`${origin}/api/`)
    if (!isApi && response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`)
    if (!isApi) return
    if (response.status() >= 500) browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`)
    void response.text().then((value) => apiBodies.push(value)).catch(() => undefined)
  })
}

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'backend/.env must define the local DATABASE_URL')
const staticAssetsPath = fileURLToPath(new URL('../../../dist/', import.meta.url))
await access(fileURLToPath(new URL('../../../dist/index.html', import.meta.url)))

const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await access(edgePath)
const port = await reserveLoopbackPort()
const origin = `http://127.0.0.1:${port}`
const runTag = randomBytes(6).toString('hex')
const originalPassword = `${randomBytes(18).toString('base64url')}Aa1!`
const replacementPassword = `${randomBytes(18).toString('base64url')}Bb2!`
const accounts = {
  owner: { name: 'Email QA Owner', email: `email-qa-owner-${runTag}@example.test` },
  member: { name: 'Email QA Member', email: `email-qa-member-${runTag}@example.test` },
  expired: { name: 'Email QA Expired', email: `email-qa-expired-${runTag}@example.test` },
}
const names = {
  workspace: `Email QA Workspace ${runTag}`,
  memberWorkspace: `Member QA Workspace ${runTag}`,
  project: `Email QA Project ${runTag}`,
  task: `Email QA Task ${runTag}`,
}

let qaDatabase: IsolatedEmailQaDatabase | undefined
let browser: Browser | undefined
let httpServer: ReturnType<ReturnType<typeof createApp>['listen']> | undefined
const capture = new CapturingEmailDelivery()
const outboxKey = Buffer.alloc(32, 29)
const logLines: string[] = []
const apiBodies: string[] = []
const consoleMessages: string[] = []
const browserErrors: string[] = []
const bearerTokens: string[] = []

try {
  qaDatabase = await createIsolatedEmailQaDatabase(databaseUrl)
  const { pool } = qaDatabase
  const logger = createLogger({ level: 'debug', write: (line) => logLines.push(line) })
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    invitationDelivery: capture,
    emailOutbox: createEmailOutbox(outboxKey),
    staticAssetsPath,
    logger,
    config: {
      frontendOrigin: origin,
      sessionSecret: 'email-qa-session-secret-with-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      verificationTtlMinutes: 60,
      passwordResetTtlMinutes: 30,
      invitationTtlHours: 24,
      recoveryResponseFloorMs: 0,
    },
  })
  httpServer = app.listen(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    httpServer!.once('listening', resolve)
    httpServer!.once('error', reject)
  })

  async function drainVerification(recipient: string) {
    assert(await processNextOutboxMessage(pool, capture, logger, outboxKey), `No verification outbox job for ${recipient}`)
    const message = capture.take('email_verification', recipient)
    assert(message, `Verification message was not captured for ${recipient}`)
    return message
  }
  async function drainReset(recipient: string) {
    assert(await processNextOutboxMessage(pool, capture, logger, outboxKey), `No reset outbox job for ${recipient}`)
    const message = capture.take('password_reset', recipient)
    assert(message, `Password reset message was not captured for ${recipient}`)
    return message
  }
  async function drainInvitation(recipient: string) {
    assert(await processNextOutboxMessage(pool, capture, logger, outboxKey), `No invitation outbox job for ${recipient}`)
    const message = capture.take('invitation', recipient)
    assert(message, `Invitation message was not captured for ${recipient}`)
    return message
  }

  browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const desktop = { width: 1440, height: 1000 }
  const ownerContext = await browser.newContext({ viewport: desktop, baseURL: origin, colorScheme: 'dark' })
  const ownerPage = await ownerContext.newPage()
  monitor(ownerPage, origin, apiBodies, consoleMessages, browserErrors)

  await register(ownerPage, accounts.owner, originalPassword)
  const queuedPayload = await pool.query<{ payload: string }>('SELECT payload::text AS payload FROM email_outbox ORDER BY created_at DESC LIMIT 1')
  assert(!queuedPayload.rows[0]?.payload.includes(accounts.owner.email), 'Outbox payload exposed the recipient')
  assert(!queuedPayload.rows[0]?.payload.includes('/verify-email'), 'Outbox payload exposed the verification URL')
  const blockedBeforeVerification = await browserApi(ownerPage, '/api/workspaces')
  assert(blockedBeforeVerification.status === 403, 'Unverified account reached protected workspace APIs')
  const invalidVerification = await browserApi(ownerPage, '/api/auth/email-verification/confirm', { method: 'POST', body: JSON.stringify({ token: 'invalid-verification-token' }) })
  assert(invalidVerification.status === 400, 'Invalid verification token was accepted')

  const ownerVerification = await drainVerification(accounts.owner.email)
  const ownerVerificationToken = tokenFromCapturedUrl(ownerVerification.verifyUrl, origin, '/verify-email')
  bearerTokens.push(ownerVerificationToken)
  const storedVerification = await pool.query<{ token_hash: string }>("SELECT token_hash FROM auth_tokens WHERE purpose='email_verification' ORDER BY created_at DESC LIMIT 1")
  assert(storedVerification.rows[0]?.token_hash === hashAuthToken(ownerVerificationToken), 'Verification token was not stored as a SHA-256 hash')

  const expiredContext = await browser.newContext({ viewport: desktop, baseURL: origin })
  const expiredPage = await expiredContext.newPage()
  monitor(expiredPage, origin, apiBodies, consoleMessages, browserErrors)
  await register(expiredPage, accounts.expired, originalPassword)
  const expiredVerification = await drainVerification(accounts.expired.email)
  const expiredVerificationToken = tokenFromCapturedUrl(expiredVerification.verifyUrl, origin, '/verify-email')
  bearerTokens.push(expiredVerificationToken)
  await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [hashAuthToken(expiredVerificationToken)])
  const expiredVerificationResult = await browserApi(expiredPage, '/api/auth/email-verification/confirm', { method: 'POST', body: JSON.stringify({ token: expiredVerificationToken }) })
  assert(expiredVerificationResult.status === 400, 'Expired verification token was accepted')
  await expiredContext.close()

  await verifyCapturedEmail(ownerPage, ownerVerification.verifyUrl)
  await ownerPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  const replayVerification = await browserApi(ownerPage, '/api/auth/email-verification/confirm', { method: 'POST', body: JSON.stringify({ token: ownerVerificationToken }) })
  assert(replayVerification.status === 400, 'Consumed verification token was replayed')
  await ownerPage.getByLabel('Workspace name').fill(names.workspace)
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click()
  await ownerPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Dashboard' }).waitFor()

  const owner = await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [accounts.owner.email])
  const ownerId = owner.rows[0]?.id
  assert(ownerId, 'Owner record was not persisted')
  const workspace = await pool.query<{ id: string }>('SELECT id FROM workspaces WHERE created_by=$1 AND name=$2', [ownerId, names.workspace])
  const workspaceId = workspace.rows[0]?.id
  assert(workspaceId, 'Workspace was not persisted')

  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await ownerPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await ownerPage.getByRole('button', { name: 'Create project' }).click()
  const projectDialog = ownerPage.getByRole('dialog', { name: 'Create project' })
  await projectDialog.getByLabel('Project name').fill(names.project)
  await projectDialog.getByLabel('Description').fill('Secure email QA workflow project.')
  await projectDialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await ownerPage.getByRole('link', { name: `Open ${names.project} project` }).click()
  await ownerPage.getByRole('heading', { name: names.project }).waitFor()
  const project = await pool.query<{ id: string }>('SELECT id FROM projects WHERE workspace_id=$1 AND name=$2', [workspaceId, names.project])
  const projectId = project.rows[0]?.id
  assert(projectId, 'Project was not persisted')

  await ownerPage.getByRole('main').getByRole('button', { name: 'Create task' }).click()
  const taskDialog = ownerPage.getByRole('dialog', { name: 'Create task' })
  await taskDialog.getByLabel('Task title').fill(names.task)
  await taskDialog.getByLabel('Description').fill('Exercise the secure local email workflow.')
  await taskDialog.getByLabel('Assignee').selectOption(ownerId)
  await taskDialog.getByLabel('Priority').selectOption('high')
  await taskDialog.getByLabel('Status').selectOption('todo')
  await taskDialog.getByRole('button', { name: 'Create task', exact: true }).click()
  await ownerPage.getByText(names.task, { exact: true }).waitFor()
  const task = await pool.query<{ id: string }>('SELECT id FROM tasks WHERE project_id=$1 AND title=$2', [projectId, names.task])
  const taskId = task.rows[0]?.id
  assert(taskId, 'Task was not persisted')

  await ownerPage.goto('/board', { waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await ownerPage.getByLabel(`Move ${names.task}`).selectOption('done')
  await ownerPage.getByTestId('kanban-column-done').getByText(names.task, { exact: true }).waitFor()
  const moved = await pool.query<{ status: string }>('SELECT status FROM tasks WHERE id=$1', [taskId])
  assert(moved.rows[0]?.status === 'done', 'Kanban status change was not persisted')

  await ownerPage.goto('/team', { waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Team' }).waitFor()
  await ownerPage.getByRole('button', { name: 'Invite member' }).click()
  const inviteDialog = ownerPage.getByRole('dialog', { name: 'Invite a teammate' })
  await inviteDialog.getByLabel('Email address').fill(accounts.member.email)
  await inviteDialog.getByLabel('Workspace role').selectOption('member')
  await inviteDialog.getByRole('button', { name: 'Create invitation' }).click()
  await inviteDialog.getByRole('heading', { name: 'Invitation queued' }).waitFor()
  assert(await inviteDialog.getByLabel('Acceptance link').count() === 0, 'Queued invitation exposed a preview link in the browser')
  const invitation = await drainInvitation(accounts.member.email)
  const invitationUrl = new URL(invitation.acceptUrl)
  assert(invitationUrl.origin === origin && invitationUrl.pathname.startsWith('/invite/'), 'Captured invitation URL was not local')
  const invitationToken = invitationUrl.pathname.slice('/invite/'.length)
  assert(invitationToken, 'Captured invitation had no token')
  bearerTokens.push(invitationToken)
  const storedInvitation = await pool.query<{ token_hash: string }>('SELECT token_hash FROM workspace_invitations WHERE workspace_id=$1 AND email=$2', [workspaceId, accounts.member.email])
  assert(storedInvitation.rows[0]?.token_hash === createHash('sha256').update(invitationToken).digest('hex'), 'Invitation token was not stored as a SHA-256 hash')
  await inviteDialog.getByRole('button', { name: 'Done' }).click()

  const memberContext = await browser.newContext({ viewport: desktop, baseURL: origin, colorScheme: 'dark' })
  const memberPage = await memberContext.newPage()
  monitor(memberPage, origin, apiBodies, consoleMessages, browserErrors)
  await register(memberPage, accounts.member, originalPassword)
  const memberVerification = await drainVerification(accounts.member.email)
  const memberVerificationToken = tokenFromCapturedUrl(memberVerification.verifyUrl, origin, '/verify-email')
  bearerTokens.push(memberVerificationToken)
  await verifyCapturedEmail(memberPage, memberVerification.verifyUrl)
  await memberPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await memberPage.getByLabel('Workspace name').fill(names.memberWorkspace)
  await memberPage.getByRole('button', { name: 'Create workspace' }).click()
  await memberPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const hiddenBeforeInvite = await browserApi(memberPage, `/api/workspaces/${workspaceId}/projects`)
  assert(hiddenBeforeInvite.status === 404, 'Non-member could read another workspace')
  await memberPage.goto(invitation.acceptUrl, { waitUntil: 'networkidle' })
  await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
  await memberPage.getByRole('heading', { name: 'Welcome to the workspace' }).waitFor()
  await memberPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const invitationReplay = await browserApi(memberPage, `/api/invitations/${invitationToken}/accept`, { method: 'POST' })
  assert(invitationReplay.status === 409, 'Accepted invitation was replayed')
  const comment = await browserApi(memberPage, `/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: 'Member collaboration verified.' }) })
  assert(comment.status === 201, 'Accepted member could not add a task comment')
  const comments = await browserApi(ownerPage, `/api/tasks/${taskId}/comments`)
  assert(comments.status === 200 && comments.text.includes('Member collaboration verified.'), 'Owner could not read the member comment')
  const invalidInvitation = await browserApi(memberPage, '/api/invitations/invalid-invitation-token')
  assert(invalidInvitation.status === 404, 'Invalid invitation token was accepted')

  const expiredInviteEmail = `expired-invite-${runTag}@example.test`
  const expiredInvitationResponse = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email: expiredInviteEmail, role: 'member' }) })
  assert(expiredInvitationResponse.status === 201, 'Could not create the expiring invitation probe')
  const expiredInvitation = await drainInvitation(expiredInviteEmail)
  const expiredInvitationToken = new URL(expiredInvitation.acceptUrl).pathname.slice('/invite/'.length)
  bearerTokens.push(expiredInvitationToken)
  await pool.query("UPDATE workspace_invitations SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [createHash('sha256').update(expiredInvitationToken).digest('hex')])
  const expiredInvitationAccept = await browserApi(memberPage, `/api/invitations/${expiredInvitationToken}/accept`, { method: 'POST' })
  assert(expiredInvitationAccept.status === 409, 'Expired invitation was accepted')

  const restoredContext = await browser.newContext({ viewport: desktop, baseURL: origin })
  const restoredPage = await restoredContext.newPage()
  monitor(restoredPage, origin, apiBodies, consoleMessages, browserErrors)
  await signIn(restoredPage, accounts.owner.email, originalPassword)

  await ownerPage.getByRole('button', { name: `Open ${accounts.owner.name} profile menu` }).click()
  await ownerPage.getByRole('menuitem', { name: 'Sign out' }).click()
  await ownerPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  await ownerPage.goto('/forgot-password', { waitUntil: 'networkidle' })
  await ownerPage.getByLabel('Email address').fill(accounts.owner.email)
  await requestPasswordReset(ownerPage)
  await ownerPage.getByText('If an account matches that email, a reset link has been sent.').waitFor()
  const expiredReset = await drainReset(accounts.owner.email)
  const expiredResetToken = tokenFromCapturedUrl(expiredReset.resetUrl, origin, '/reset-password')
  bearerTokens.push(expiredResetToken)
  await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [hashAuthToken(expiredResetToken)])
  const expiredResetResult = await browserApi(ownerPage, '/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: expiredResetToken, password: replacementPassword }) })
  assert(expiredResetResult.status === 400, 'Expired password reset token was accepted')

  await requestPasswordReset(ownerPage)
  const reset = await drainReset(accounts.owner.email)
  const resetToken = tokenFromCapturedUrl(reset.resetUrl, origin, '/reset-password')
  bearerTokens.push(resetToken)
  await ownerPage.goto(reset.resetUrl, { waitUntil: 'networkidle' })
  await ownerPage.getByLabel('New password', { exact: true }).fill(replacementPassword)
  await ownerPage.getByLabel('Confirm new password', { exact: true }).fill(replacementPassword)
  await ownerPage.getByRole('button', { name: 'Reset password' }).click()
  await ownerPage.getByText('Your password has been reset. Sign in with your new password.').waitFor()
  const resetReplay = await browserApi(ownerPage, '/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: resetToken, password: originalPassword }) })
  assert(resetReplay.status === 400, 'Consumed password reset token was replayed')
  const invalidatedOldSession = await browserApi(restoredPage, '/api/workspaces')
  assert(invalidatedOldSession.status === 401, 'Password reset did not invalidate an older session')
  await signIn(ownerPage, accounts.owner.email, replacementPassword)
  await ownerPage.getByRole('button', { name: `Open ${accounts.owner.name} profile menu` }).click()
  await ownerPage.getByRole('menuitem', { name: 'Sign out' }).click()
  await ownerPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  const anonymousWorkspaces = await browserApi(ownerPage, '/api/workspaces')
  assert(anonymousWorkspaces.status === 401, 'Logout left the browser session authenticated')

  const storageSnapshots = await Promise.all([ownerPage, memberPage, restoredPage].map((page) => page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
  }))))
  const cookieSnapshots = await Promise.all([ownerContext, memberContext, restoredContext].map((context) => context.cookies()))
  const browserStorage = JSON.stringify({ storageSnapshots, cookieSnapshots })

  await Promise.all([ownerContext.close(), memberContext.close(), restoredContext.close()])
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join('; ')}`)
  const externallyVisible = `${apiBodies.join('\n')}\n${logLines.join('\n')}\n${consoleMessages.join('\n')}\n${browserErrors.join('\n')}\n${browserStorage}`
  for (const token of bearerTokens) assert(!externallyVisible.includes(token), 'A bearer token appeared in an API response, log, console message, or browser storage')
  assert(!externallyVisible.includes('/verify-email?token='), 'A verification URL appeared in an API response or log')
  assert(!externallyVisible.includes('/reset-password?token='), 'A reset URL appeared in an API response or log')
  assert(!externallyVisible.includes('/invite/invalid-invitation-token'), 'An invitation token appeared in application logs')

  console.log(JSON.stringify({
    status: 'passed',
    checks: [
      'encrypted outbox capture', 'verification expiration and replay', 'session restoration',
      'workspace/project/task/Kanban persistence', 'invitation acceptance and replay',
      'collaboration and workspace isolation', 'password reset expiration, replay, and session invalidation',
      'logout and secret-safe responses/logs/storage',
    ],
  }))
} finally {
  capture.clear()
  if (browser) await browser.close().catch(() => undefined)
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  const schema = qaDatabase?.schema
  if (qaDatabase) await qaDatabase.dispose()
  if (schema) {
    const verifier = new Pool({ connectionString: databaseUrl })
    try {
      const remaining = await verifier.query<{ exists: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS exists', [schema])
      assert(!remaining.rows[0]?.exists, 'Disposable email QA schema remained after cleanup')
    } finally {
      await verifier.end()
    }
  }
}
