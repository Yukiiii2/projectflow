import { randomBytes, randomUUID, createHash } from 'node:crypto'
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
const runId = randomUUID(); const tag = runId.slice(0, 8); const password = `${randomBytes(24).toString('base64url')}Aa1!`
const accounts = [
  { name: 'Stage E Owner', email: `stage-e-owner-${tag}@example.invalid` },
  { name: 'Stage E Collaborator', email: `stage-e-collaborator-${tag}@example.invalid` },
  { name: 'Stage E Outsider', email: `stage-e-outsider-${tag}@example.invalid` },
]
const names = { workspace: `Stage E Workspace ${runId.slice(0, 6)}`, project: 'Collaboration launch', task: 'Review collaboration release' }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const report = { frontendUrl, apiUrl, generatedAt: new Date().toISOString(), checks: [], screenshots: [], temporaryAccountsRemaining: 0 }
await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  await page.waitForTimeout(180)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const layout = await page.evaluate(() => ({
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    outOfBounds: [...document.querySelectorAll('button,a,input,select,textarea,h1,h2,p,article')].filter((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1) }).map((node) => node.textContent?.trim().slice(0, 55)).slice(0, 8),
  }))
  const violations = accessibility.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }))
  const file = path.join(outputDir, `${name}.png`); await page.screenshot({ path: file, fullPage: true })
  report.screenshots.push({ name, viewport, file, ...layout, violations })
  if (layout.horizontalOverflow || layout.outOfBounds.length || violations.length) throw new Error(`Visual QA failed for ${name}: ${JSON.stringify({ layout, violations })}`)
}

async function registerWithWorkspace(page, account, workspaceName) {
  await page.goto(`${frontendUrl}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(account.name); await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await page.getByLabel('Workspace name').fill(workspaceName); await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  return (await pool.query('SELECT id FROM users WHERE email=$1', [account.email])).rows[0].id
}

async function browserApi(page, pathname, init = {}) {
  return page.evaluate(async ({ url, request }) => { const response = await fetch(url, { ...request, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(request.headers ?? {}) } }); return { status: response.status, body: response.status === 204 ? null : await response.json() } }, { url: `${apiUrl}${pathname}`, request: init })
}

async function cleanup() {
  const users = await pool.query('SELECT id,email FROM users WHERE email=ANY($1::text[])', [accounts.map((item) => item.email)])
  for (const row of users.rows) await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [row.id])
  const owner = users.rows.find((row) => row.email === accounts[0].email)
  if (owner) await pool.query('DELETE FROM workspaces WHERE created_by=$1', [owner.id])
  for (const row of users.rows) await pool.query('DELETE FROM workspaces WHERE created_by=$1', [row.id])
  for (const row of users.rows) await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [row.id, row.email])
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true })
try {
  const desktop = { width: 1440, height: 1000 }
  const ownerContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' }); const ownerPage = await ownerContext.newPage()
  const errors = []; ownerPage.on('pageerror', (error) => errors.push(error.message))
  const ownerId = await registerWithWorkspace(ownerPage, accounts[0], names.workspace)
  const workspaceId = (await pool.query('SELECT id FROM workspaces WHERE created_by=$1', [ownerId])).rows[0].id
  const project = (await browserApi(ownerPage, `/api/workspaces/${workspaceId}/projects`, { method: 'POST', body: JSON.stringify({ name: names.project, description: 'Stage E collaboration verification.' }) })).body.project
  const task = (await browserApi(ownerPage, `/api/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: names.task, priority: 'high', status: 'in_progress' }) })).body.task

  await ownerPage.goto(`${frontendUrl}/team`, { waitUntil: 'networkidle' }); await ownerPage.getByRole('heading', { name: 'Team' }).waitFor()
  await inspect(ownerPage, 'stage-e-team-desktop', desktop)
  await ownerPage.getByRole('button', { name: 'Invite member' }).click()
  const dialog = ownerPage.getByRole('dialog', { name: 'Invite a teammate' })
  await dialog.getByLabel('Email address').fill(accounts[1].email); await dialog.getByLabel('Workspace role').selectOption('member')
  await dialog.getByRole('button', { name: 'Create invitation' }).click(); await dialog.getByText('Preview invitation ready').waitFor()
  const invitationUrl = await dialog.getByLabel('Acceptance link').inputValue()
  if (!invitationUrl.startsWith(`${frontendUrl}/invite/`)) throw new Error('Preview delivery did not return a local acceptance link')
  const token = invitationUrl.split('/').at(-1)
  const storedInvitation = await pool.query('SELECT token_hash FROM workspace_invitations WHERE workspace_id=$1 AND email=$2', [workspaceId, accounts[1].email])
  if (storedInvitation.rows[0]?.token_hash !== createHash('sha256').update(token).digest('hex') || storedInvitation.rows[0].token_hash === token) throw new Error('Invitation token was not stored as a SHA-256 hash')
  report.checks.push('Preview delivery clearly reports no email; database stores only the token hash')
  await dialog.getByRole('button', { name: 'Done' }).click()

  const inviteeContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' }); const inviteePage = await inviteeContext.newPage()
  await inviteePage.goto(invitationUrl, { waitUntil: 'networkidle' }); await inviteePage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  await inviteePage.getByRole('link', { name: 'Create an account' }).click()
  await inviteePage.getByLabel('Full name').fill(accounts[1].name); await inviteePage.getByLabel('Email address').fill(accounts[1].email)
  await inviteePage.getByLabel('Password', { exact: true }).fill(password); await inviteePage.getByLabel('Confirm password').fill(password)
  await inviteePage.getByRole('button', { name: 'Create account' }).click(); await inviteePage.getByRole('heading', { name: names.workspace }).waitFor()
  await inviteePage.getByRole('button', { name: 'Accept invitation' }).click(); await inviteePage.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 8000 })
  const inviteeId = (await pool.query('SELECT id FROM users WHERE email=$1', [accounts[1].email])).rows[0].id
  const membership = await pool.query('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, inviteeId])
  if (membership.rows[0]?.role !== 'member') throw new Error('Invitation acceptance did not persist the membership')
  report.checks.push('Authenticated matching-email invitation acceptance persists and restores the workspace session')

  await ownerPage.reload({ waitUntil: 'networkidle' }); await ownerPage.getByText(accounts[1].name, { exact: true }).waitFor()
  const memberRow = ownerPage.locator('.team-member-row').filter({ hasText: accounts[1].name })
  await memberRow.getByLabel(`Role for ${accounts[1].name}`).selectOption('admin'); await ownerPage.getByText(`${accounts[1].name} is now an admin.`).waitFor()
  if ((await pool.query('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, inviteeId])).rows[0]?.role !== 'admin') throw new Error('Role update did not persist')
  await inviteePage.reload({ waitUntil: 'networkidle' }); await inviteePage.goto(`${frontendUrl}/team`, { waitUntil: 'networkidle' })
  if (await inviteePage.getByLabel(`Role for ${accounts[1].name}`).count()) throw new Error('Admin received owner-only role controls')
  report.checks.push('Owner role changes persist; admin controls remain within policy')

  const expiredEmail = `expired-${tag}@example.invalid`; const revokedEmail = `revoked-${tag}@example.invalid`
  const expired = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email: expiredEmail, role: 'member' }) })
  const revoked = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email: revokedEmail, role: 'member' }) })
  await pool.query('UPDATE workspace_invitations SET expires_at=now()-interval \'1 hour\' WHERE id=$1', [expired.body.invitation.id])
  await browserApi(ownerPage, `/api/workspaces/${workspaceId}/invitations/${revoked.body.invitation.id}`, { method: 'DELETE' })
  await ownerPage.reload({ waitUntil: 'networkidle' }); await ownerPage.getByText('Expired', { exact: true }).waitFor(); await ownerPage.getByText('Revoked', { exact: true }).waitFor(); await ownerPage.getByText('Accepted', { exact: true }).waitFor()
  await inspect(ownerPage, 'stage-e-team-populated-desktop', desktop)
  report.checks.push('Pending, accepted, expired, and revoked invitation states are persisted and rendered')

  await ownerPage.goto(`${frontendUrl}/tasks`, { waitUntil: 'networkidle' }); await ownerPage.getByText(names.task, { exact: true }).click()
  let panel = ownerPage.getByRole('dialog', { name: 'Edit task' }); await panel.getByLabel('Assignee').selectOption(inviteeId); await panel.getByRole('button', { name: 'Save changes' }).click(); await panel.waitFor({ state: 'hidden' })
  if ((await pool.query('SELECT assignee_id FROM tasks WHERE id=$1', [task.id])).rows[0]?.assignee_id !== inviteeId) throw new Error('Accepted workspace member could not be assigned')
  await ownerPage.getByText(names.task, { exact: true }).click(); panel = ownerPage.getByRole('dialog', { name: 'Edit task' }); await panel.getByRole('tab', { name: 'Comments' }).click()
  await panel.getByLabel('Add a comment').fill('Owner review is complete.'); await panel.getByRole('button', { name: 'Post comment' }).click(); await panel.getByText('Owner review is complete.').waitFor()
  await panel.getByRole('button', { name: 'Edit comment' }).click(); const editor = panel.getByRole('textbox', { name: 'Edit comment' }); await editor.fill('Owner review is complete and approved.'); await panel.getByRole('button', { name: 'Save comment' }).click()
  await panel.getByText('Owner review is complete and approved.').waitFor(); await panel.getByRole('button', { name: 'Close edit task' }).click()

  await inviteePage.goto(`${frontendUrl}/tasks`, { waitUntil: 'networkidle' }); await inviteePage.getByText(names.task, { exact: true }).click(); let inviteePanel = inviteePage.getByRole('dialog', { name: 'Edit task' }); await inviteePanel.getByRole('tab', { name: 'Comments' }).click()
  await inviteePanel.getByText('Owner review is complete and approved.').waitFor(); await inviteePanel.getByLabel('Add a comment').fill('Collaborator confirms the handoff.'); await inviteePanel.getByRole('button', { name: 'Post comment' }).click(); await inviteePanel.getByText('Collaborator confirms the handoff.').waitFor()
  await inviteePanel.getByRole('button', { name: 'Close edit task' }).click()

  await ownerPage.getByText(names.task, { exact: true }).click(); panel = ownerPage.getByRole('dialog', { name: 'Edit task' }); await panel.getByRole('tab', { name: 'Comments' }).click(); const memberComment = panel.locator('.comment-item').filter({ hasText: 'Collaborator confirms the handoff.' })
  ownerPage.once('dialog', (dialogEvent) => void dialogEvent.accept()); await memberComment.getByRole('button', { name: 'Delete comment' }).click(); await memberComment.waitFor({ state: 'detached' })
  await ownerPage.setViewportSize({ width: 390, height: 844 }); await inspect(ownerPage, 'stage-e-task-comments-mobile', { width: 390, height: 844 })
  await panel.getByRole('tab', { name: 'Activity' }).click(); await panel.getByText(/added a comment|edited a comment|deleted a comment/).first().waitFor(); await inspect(ownerPage, 'stage-e-task-activity-mobile', { width: 390, height: 844 })
  report.checks.push('Assignment, comment create/edit, owner moderation, activity, and refresh persistence passed')

  await panel.getByRole('button', { name: 'Close edit task' }).click()
  await ownerPage.goto(`${frontendUrl}/team`, { waitUntil: 'networkidle' }); await inspect(ownerPage, 'stage-e-team-mobile', { width: 390, height: 844 })
  await ownerPage.setViewportSize({ width: 320, height: 720 }); await inspect(ownerPage, 'stage-e-team-narrow', { width: 320, height: 720 })

  const outsiderContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' }); const outsiderPage = await outsiderContext.newPage()
  await outsiderPage.goto(`${frontendUrl}/register`, { waitUntil: 'networkidle' }); await outsiderPage.getByLabel('Full name').fill(accounts[2].name); await outsiderPage.getByLabel('Email address').fill(accounts[2].email); await outsiderPage.getByLabel('Password', { exact: true }).fill(password); await outsiderPage.getByLabel('Confirm password').fill(password); await outsiderPage.getByRole('button', { name: 'Create account' }).click(); await outsiderPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  const hiddenMembers = await browserApi(outsiderPage, `/api/workspaces/${workspaceId}/members`); const hiddenComments = await browserApi(outsiderPage, `/api/tasks/${task.id}/comments`); const hiddenActivity = await browserApi(outsiderPage, `/api/tasks/${task.id}/activity`)
  if ([hiddenMembers.status, hiddenComments.status, hiddenActivity.status].some((status) => status !== 404)) throw new Error('Cross-workspace collaboration data was exposed')
  report.checks.push('Cross-workspace members, comments, and activity return 404')

  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
  await ownerContext.close(); await inviteeContext.close(); await outsiderContext.close()
  console.log('Stage E browser QA passed: invitations, roles, assignments, comments, activity, isolation, accessibility, and responsive layouts.')
} finally {
  await browser.close(); await cleanup()
  const remaining = await pool.query('SELECT count(*)::int AS count FROM users WHERE email=ANY($1::text[])', [accounts.map((item) => item.email)])
  report.temporaryAccountsRemaining = remaining.rows[0]?.count ?? 0; await pool.end()
  await writeFile(path.resolve('artifacts/collaboration-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
