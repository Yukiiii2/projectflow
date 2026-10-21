import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright-core'

const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url))
const dotenv = backendRequire('dotenv'); const pg = backendRequire('pg')
dotenv.config({ path: path.resolve('backend/.env') })

const frontendUrl = process.env.PROJECTFLOW_URL ?? 'http://localhost:5173'
const apiUrl = process.env.PROJECTFLOW_API_URL ?? 'http://localhost:4000'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = path.resolve('artifacts/screenshots')
const runId = randomUUID(); const tag = runId.slice(0, 8)
const password = `${randomBytes(24).toString('base64url')}Aa1!`
const accounts = [
  { name: 'Stage F Owner', email: `stage-f-owner-${tag}@example.invalid` },
  { name: 'Stage F Collaborator', email: `stage-f-collaborator-${tag}@example.invalid` },
  { name: 'Stage F Outsider', email: `stage-f-outsider-${tag}@example.invalid` },
]
const names = {
  workspace: `Stage F Workspace ${tag}`,
  project: `Stage F Launch ${tag}`,
  task: `Verify release ${tag}`,
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const report = {
  generatedAt: new Date().toISOString(), frontendUrl, apiUrl, checks: [], screenshots: [],
  securityHeaders: {}, temporaryAccountsRemaining: 0,
}
await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(180)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const layout = await page.evaluate(() => ({
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    outOfBounds: [...document.querySelectorAll('button,a,input,select,textarea,h1,h2,p,article')]
      .filter((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1) })
      .map((node) => node.textContent?.trim().slice(0, 55)).slice(0, 8),
  }))
  const violations = accessibility.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }))
  const file = path.join(outputDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  report.screenshots.push({ name, viewport, file, ...layout, violations })
  if (layout.horizontalOverflow || layout.outOfBounds.length || violations.length) {
    throw new Error(`Visual QA failed for ${name}: ${JSON.stringify({ layout, violations })}`)
  }
}

async function browserApi(page, pathname, init = {}) {
  return page.evaluate(async ({ url, request }) => {
    const response = await fetch(url, { ...request, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(request.headers ?? {}) } })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }, { url: `${apiUrl}${pathname}`, request: init })
}

async function register(page, account) {
  await page.goto(`${frontendUrl}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(account.name)
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

async function cleanup() {
  const users = await pool.query('SELECT id,email FROM users WHERE email=ANY($1::text[])', [accounts.map((account) => account.email)])
  for (const row of users.rows) await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [row.id])
  for (const row of users.rows) await pool.query('DELETE FROM workspaces WHERE created_by=$1', [row.id])
  for (const row of users.rows) await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [row.id, row.email])
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true })
try {
  const desktop = { width: 1440, height: 1000 }
  const ownerContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' })
  const ownerPage = await ownerContext.newPage()
  const pageErrors = []
  ownerPage.on('pageerror', (error) => pageErrors.push(error.message))

  const healthResponse = await ownerPage.request.get(`${apiUrl}/api/health`)
  if (!healthResponse.ok() || (await healthResponse.json()).status !== 'ok') throw new Error('API health check failed')
  report.securityHeaders = {
    contentTypeOptions: healthResponse.headers()['x-content-type-options'],
    frameOptions: healthResponse.headers()['x-frame-options'],
    resourcePolicy: healthResponse.headers()['cross-origin-resource-policy'],
  }
  if (report.securityHeaders.contentTypeOptions !== 'nosniff' || !report.securityHeaders.frameOptions) throw new Error('Expected Helmet response headers were missing')

  await register(ownerPage, accounts[0])
  await ownerPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await ownerPage.getByLabel('Workspace name').fill(names.workspace)
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click()
  await ownerPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const ownerId = (await pool.query('SELECT id FROM users WHERE email=$1', [accounts[0].email])).rows[0].id
  const workspaceId = (await pool.query('SELECT id FROM workspaces WHERE created_by=$1', [ownerId])).rows[0].id
  await inspect(ownerPage, 'stage-f-empty-dashboard-desktop', desktop)
  report.checks.push('Registration, session creation, workspace onboarding, and empty dashboard passed')

  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await ownerPage.getByRole('button', { name: 'Create project' }).click()
  const projectDialog = ownerPage.getByRole('dialog', { name: 'Create project' })
  await projectDialog.getByLabel('Project name').fill(names.project)
  await projectDialog.getByLabel('Description').fill('Deployment-readiness validation for ProjectFlow.')
  await projectDialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await ownerPage.getByRole('link', { name: `Open ${names.project} project` }).click()
  await ownerPage.getByRole('main').getByRole('button', { name: 'Create task' }).click()
  const createTask = ownerPage.getByRole('dialog', { name: 'Create task' })
  await createTask.getByLabel('Task title').fill(names.task)
  await createTask.getByLabel('Description').fill('Exercise the complete release candidate workflow.')
  await createTask.getByLabel('Assignee').selectOption(ownerId)
  await createTask.getByLabel('Priority').selectOption('high')
  await createTask.getByLabel('Due date').fill('2026-10-27')
  await createTask.getByRole('button', { name: 'Create task', exact: true }).click()
  await ownerPage.getByText(names.task, { exact: true }).waitFor()
  const projectId = (await pool.query('SELECT id FROM projects WHERE workspace_id=$1 AND name=$2', [workspaceId, names.project])).rows[0].id
  const taskId = (await pool.query('SELECT id FROM tasks WHERE project_id=$1 AND title=$2', [projectId, names.task])).rows[0].id
  await inspect(ownerPage, 'stage-f-project-desktop', desktop)

  await ownerPage.goto(frontendUrl, { waitUntil: 'networkidle' })
  await ownerPage.getByTestId('active-projects-value').waitFor()
  if (await ownerPage.getByTestId('active-projects-value').textContent() !== '1') throw new Error('Dashboard project count was not database-backed')
  if (!(await ownerPage.getByTestId('tasks-completed-value').textContent())?.includes('0 / 1')) throw new Error('Dashboard task count was inconsistent')
  await inspect(ownerPage, 'stage-f-dashboard-desktop', desktop)
  report.checks.push('Project/task creation, due date persistence, and dashboard statistics passed')

  await ownerPage.goto(`${frontendUrl}/board`, { waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await ownerPage.getByLabel(`Move ${names.task}`).selectOption('in_progress')
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByLabel(`Move ${names.task}`).waitFor()
  if (await ownerPage.getByLabel(`Move ${names.task}`).inputValue() !== 'in_progress') throw new Error('Kanban status did not survive refresh')
  if ((await pool.query('SELECT status,due_date::text FROM tasks WHERE id=$1', [taskId])).rows[0]?.status !== 'in_progress') throw new Error('Kanban status was not persisted')
  await inspect(ownerPage, 'stage-f-board-tablet', { width: 768, height: 900 })
  report.checks.push('Accessible Kanban movement and PostgreSQL refresh persistence passed')

  await ownerPage.setViewportSize(desktop)
  await ownerPage.goto(`${frontendUrl}/team`, { waitUntil: 'networkidle' })
  const inviteTrigger = ownerPage.getByRole('button', { name: 'Invite member' })
  await inviteTrigger.click(); await ownerPage.keyboard.press('Escape')
  await ownerPage.getByRole('dialog', { name: 'Invite a teammate' }).waitFor({ state: 'hidden' })
  if (!(await inviteTrigger.evaluate((element) => element === document.activeElement))) throw new Error('Invitation dialog did not restore focus')
  await inviteTrigger.click()
  const inviteDialog = ownerPage.getByRole('dialog', { name: 'Invite a teammate' })
  await inviteDialog.getByLabel('Email address').fill(accounts[1].email)
  await inviteDialog.getByRole('button', { name: 'Create invitation' }).click()
  const invitationUrl = await inviteDialog.getByLabel('Acceptance link').inputValue()
  const token = invitationUrl.split('/').at(-1)
  const storedToken = (await pool.query('SELECT token_hash FROM workspace_invitations WHERE workspace_id=$1 AND email=$2', [workspaceId, accounts[1].email])).rows[0]?.token_hash
  if (storedToken !== createHash('sha256').update(token).digest('hex') || storedToken === token) throw new Error('Invitation token storage was unsafe')
  await inviteDialog.getByRole('button', { name: 'Done' }).click()

  const inviteeContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' })
  const inviteePage = await inviteeContext.newPage()
  await inviteePage.goto(invitationUrl, { waitUntil: 'networkidle' })
  await inviteePage.getByRole('link', { name: 'Create an account' }).click()
  await inviteePage.getByLabel('Full name').fill(accounts[1].name)
  await inviteePage.getByLabel('Email address').fill(accounts[1].email)
  await inviteePage.getByLabel('Password', { exact: true }).fill(password)
  await inviteePage.getByLabel('Confirm password').fill(password)
  await inviteePage.getByRole('button', { name: 'Create account' }).click()
  await inviteePage.getByRole('button', { name: 'Accept invitation' }).click()
  await inviteePage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const inviteeId = (await pool.query('SELECT id FROM users WHERE email=$1', [accounts[1].email])).rows[0].id
  if ((await pool.query('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, inviteeId])).rows[0]?.role !== 'member') throw new Error('Invitation membership did not persist')
  report.checks.push('Hashed invitation, account return path, acceptance, and membership persistence passed')

  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByLabel(`Role for ${accounts[1].name}`).selectOption('admin')
  await ownerPage.goto(`${frontendUrl}/tasks`, { waitUntil: 'networkidle' })
  await ownerPage.getByText(names.task, { exact: true }).click()
  let taskPanel = ownerPage.getByRole('dialog', { name: 'Edit task' })
  await taskPanel.getByLabel('Assignee').selectOption(inviteeId)
  await taskPanel.getByRole('button', { name: 'Save changes' }).click()
  await ownerPage.getByText(names.task, { exact: true }).click()
  taskPanel = ownerPage.getByRole('dialog', { name: 'Edit task' })
  await taskPanel.getByRole('tab', { name: 'Comments' }).click()
  await taskPanel.getByLabel('Add a comment').fill('Stage F owner review complete.')
  await taskPanel.getByRole('button', { name: 'Post comment' }).click()
  await taskPanel.getByText('Stage F owner review complete.').waitFor()
  await taskPanel.getByRole('tab', { name: 'Activity' }).click()
  await taskPanel.getByText(/assigned this task|updated this task|added a comment/).first().waitFor()
  await taskPanel.getByRole('button', { name: 'Close edit task' }).click()

  await inviteePage.goto(`${frontendUrl}/tasks`, { waitUntil: 'networkidle' })
  await inviteePage.getByText(names.task, { exact: true }).click()
  const inviteePanel = inviteePage.getByRole('dialog', { name: 'Edit task' })
  await inviteePanel.getByRole('tab', { name: 'Comments' }).click()
  await inviteePanel.getByLabel('Add a comment').fill('Stage F collaborator confirms the handoff.')
  await inviteePanel.getByRole('button', { name: 'Post comment' }).click()
  await inviteePage.reload({ waitUntil: 'networkidle' })
  report.checks.push('Role change, authorized assignment, comments, activity, and refresh persistence passed')

  const revoked = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email: `revoked-${tag}@example.invalid`, role: 'member' }) })
  const expired = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email: `expired-${tag}@example.invalid`, role: 'member' }) })
  await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations/${revoked.body.invitation.id}`, { method: 'DELETE' })
  await pool.query("UPDATE workspace_invitations SET expires_at=now()-interval '1 hour' WHERE id=$1", [expired.body.invitation.id])
  const revokedToken = revoked.body.delivery.preview_url.split('/').at(-1)
  const expiredToken = expired.body.delivery.preview_url.split('/').at(-1)
  const revokedStatus = await fetch(`${apiUrl}/api/invitations/${revokedToken}`).then((response) => response.json())
  const expiredStatus = await fetch(`${apiUrl}/api/invitations/${expiredToken}`).then((response) => response.json())
  if (revokedStatus.invitation?.status !== 'revoked' || expiredStatus.invitation?.status !== 'expired') throw new Error('Invitation lifecycle states were inconsistent')

  const outsiderContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' })
  const outsiderPage = await outsiderContext.newPage()
  await register(outsiderPage, accounts[2])
  await outsiderPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  const ownerCommentId = (await pool.query('SELECT id FROM comments WHERE task_id=$1 ORDER BY created_at LIMIT 1', [taskId])).rows[0].id
  const isolationRequests = [
    [`/api/workspaces/${workspaceId}/projects`, 'GET'], [`/api/workspaces/${workspaceId}/tasks`, 'GET'],
    [`/api/workspaces/${workspaceId}/members`, 'GET'], [`/api/workspaces/${workspaceId}/invitations`, 'GET'],
    [`/api/projects/${projectId}`, 'GET'], [`/api/projects/${projectId}/tasks`, 'GET'],
    [`/api/tasks/${taskId}/comments`, 'GET'], [`/api/tasks/${taskId}/activity`, 'GET'],
    [`/api/tasks/${taskId}`, 'PATCH'], [`/api/comments/${ownerCommentId}`, 'PATCH'],
  ]
  for (const [pathname, method] of isolationRequests) {
    const result = await browserApi(outsiderPage, pathname, { method, ...(method === 'PATCH' ? { body: JSON.stringify(pathname.includes('/comments/') ? { body: 'blocked' } : { status: 'done' }) } : {}) })
    if (result.status !== 404) throw new Error(`Cross-workspace request was not concealed: ${method} ${pathname} returned ${result.status}`)
  }
  report.checks.push('Direct cross-workspace reads and writes returned 404 across all core resources')

  const ownerCookies = await ownerContext.cookies(apiUrl)
  const cookieHeader = ownerCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  const hostile = await fetch(`${apiUrl}/api/workspaces`, { method: 'POST', headers: { Origin: 'https://attacker.example', Cookie: cookieHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Blocked workspace' }) })
  if (hostile.status !== 403) throw new Error('Hostile-origin write was not rejected')
  const oversized = await fetch(`${apiUrl}/api/auth/register`, { method: 'POST', headers: { Origin: frontendUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Large', email: 'large@example.invalid', password: 'x'.repeat(70_000) }) })
  if (oversized.status !== 413 || (await oversized.json()).error !== 'Request body is too large') throw new Error('Oversized request did not return safe 413 JSON')
  report.checks.push('Origin enforcement, request limits, security headers, and safe error responses passed')

  await ownerPage.setViewportSize({ width: 390, height: 844 })
  await ownerPage.goto(frontendUrl, { waitUntil: 'networkidle' })
  const drawerTrigger = ownerPage.getByRole('button', { name: 'Open navigation drawer' })
  await drawerTrigger.click()
  const drawerClose = ownerPage.getByRole('button', { name: 'Close navigation drawer' })
  if (!(await drawerClose.evaluate((element) => element === document.activeElement))) throw new Error('Mobile drawer did not receive focus')
  await ownerPage.keyboard.press('Shift+Tab')
  if ((await ownerPage.evaluate(() => document.activeElement?.getAttribute('aria-label'))) !== 'Sign out') throw new Error('Mobile drawer did not trap reverse tab focus')
  await drawerClose.focus(); await ownerPage.keyboard.press('Escape')
  await ownerPage.getByLabel('Mobile navigation').waitFor({ state: 'hidden' })
  if (!(await drawerTrigger.evaluate((element) => element === document.activeElement))) throw new Error('Mobile drawer did not restore focus')
  await inspect(ownerPage, 'stage-f-dashboard-mobile', { width: 390, height: 844 })
  await ownerPage.goto(`${frontendUrl}/team`, { waitUntil: 'networkidle' })
  await inspect(ownerPage, 'stage-f-team-mobile', { width: 390, height: 844 })
  await ownerPage.goto(`${frontendUrl}/board`, { waitUntil: 'networkidle' })
  await inspect(ownerPage, 'stage-f-board-narrow', { width: 320, height: 720 })
  report.checks.push('Dialog and drawer keyboard behavior plus desktop/tablet/mobile/narrow layouts passed')

  await ownerPage.setViewportSize(desktop)
  await ownerPage.goto(frontendUrl, { waitUntil: 'networkidle' })
  await ownerPage.getByRole('button', { name: `Open ${accounts[0].name} profile menu` }).click()
  await ownerPage.getByRole('menuitem', { name: 'Sign out' }).click()
  await ownerPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  if ((await ownerContext.cookies(apiUrl)).some((cookie) => cookie.name.includes('projectflow.sid'))) throw new Error('Logout did not clear the session cookie')
  await ownerPage.goto(`${frontendUrl}/projects`, { waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  await ownerPage.getByLabel('Email address').fill(accounts[0].email)
  await ownerPage.getByLabel('Password', { exact: true }).fill(password)
  await ownerPage.getByRole('button', { name: 'Sign in' }).click()
  await ownerPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  report.checks.push('Logout, protected-route redirect, sign-in, and session restoration passed')

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join('; ')}`)
  await ownerContext.close(); await inviteeContext.close(); await outsiderContext.close()
  console.log('Stage F QA passed: full journey, security boundaries, sessions, accessibility, and responsive layouts.')
} finally {
  await browser.close()
  await cleanup()
  const remaining = await pool.query('SELECT count(*)::int AS count FROM users WHERE email=ANY($1::text[])', [accounts.map((account) => account.email)])
  report.temporaryAccountsRemaining = remaining.rows[0]?.count ?? 0
  await pool.end()
  await writeFile(path.resolve('artifacts/stage-f-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
