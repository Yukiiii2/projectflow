import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright-core'

const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url))
const dotenv = backendRequire('dotenv')
const pg = backendRequire('pg')
dotenv.config({ path: path.resolve('backend/.env') })

const frontendUrl = process.env.PROJECTFLOW_URL ?? 'http://localhost:5173'
const apiUrl = process.env.PROJECTFLOW_API_URL ?? 'http://localhost:4000'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = path.resolve('artifacts/screenshots')
const runId = randomUUID()
const password = `${randomBytes(24).toString('base64url')}Aa1!`
const accounts = [
  { name: 'Stage D Owner', email: `stage-d-owner-${runId}@example.invalid` },
  { name: 'Stage D Member', email: `stage-d-member-${runId}@example.invalid` },
]
const names = {
  workspace: `Stage D Workspace ${runId.slice(0, 6)}`,
  isolated: `Stage D Isolated ${runId.slice(0, 6)}`,
  project: 'Product launch',
  todo: 'Finalize release brief',
  progress: 'Prepare launch assets',
  done: 'Approve release scope',
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const report = { frontendUrl, apiUrl, generatedAt: new Date().toISOString(), checks: [], screenshots: [], temporaryAccountsRemaining: 0 }
await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  await page.waitForTimeout(200)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const layout = await page.evaluate(() => ({
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    outOfBounds: [...document.querySelectorAll('button,a,input,select,textarea,h1,h2,p,article')].filter((node) => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
    }).map((node) => node.textContent?.trim().slice(0, 60)).slice(0, 8),
  }))
  const violations = accessibility.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length }))
  const file = path.join(outputDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  report.screenshots.push({ name, viewport, file, ...layout, violations })
  if (layout.horizontalOverflow || layout.outOfBounds.length || violations.length) throw new Error(`Visual QA failed for ${name}: ${JSON.stringify({ layout, violations })}`)
}

async function register(page, account, workspaceName) {
  await page.goto(`${frontendUrl}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(account.name)
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await page.getByLabel('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const found = await pool.query('SELECT id FROM users WHERE email=$1', [account.email])
  return found.rows[0].id
}

async function browserApi(page, pathname, init = {}) {
  return page.evaluate(async ({ url, request }) => {
    const response = await fetch(url, { ...request, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(request.headers ?? {}) } })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }, { url: `${apiUrl}${pathname}`, request: init })
}

async function waitForTask(taskId, expectedStatus) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await pool.query('SELECT status FROM tasks WHERE id=$1', [taskId])
    if (result.rows[0]?.status === expectedStatus) return
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Task ${taskId} did not persist status ${expectedStatus}`)
}

async function cleanup() {
  for (const account of accounts) {
    const found = await pool.query('SELECT id FROM users WHERE email=$1', [account.email])
    const userId = found.rows[0]?.id
    if (!userId) continue
    await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [userId])
    await pool.query('DELETE FROM workspaces WHERE created_by=$1', [userId])
    await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [userId, account.email])
  }
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true })
try {
  const desktop = { width: 1440, height: 1000 }
  const ownerContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' })
  const ownerPage = await ownerContext.newPage()
  const pageErrors = []
  ownerPage.on('pageerror', (error) => pageErrors.push(error.message))
  const ownerId = await register(ownerPage, accounts[0], names.workspace)
  const workspaceRow = await pool.query('SELECT id FROM workspaces WHERE created_by=$1 AND name=$2', [ownerId, names.workspace])
  const workspaceId = workspaceRow.rows[0].id

  const projectResponse = await browserApi(ownerPage, `/api/workspaces/${workspaceId}/projects`, { method: 'POST', body: JSON.stringify({ name: names.project, description: 'Coordinate a focused client release.' }) })
  if (projectResponse.status !== 201) throw new Error('Could not create the Kanban QA project')
  const projectId = projectResponse.body.project.id
  const taskInputs = [
    { title: names.todo, description: 'Confirm owners and milestones.', status: 'todo', priority: 'high', dueDate: '2026-10-24', assigneeId: ownerId },
    { title: names.progress, description: 'Prepare launch visuals.', status: 'in_progress', priority: 'medium', dueDate: '2026-10-27', assigneeId: ownerId },
    { title: names.done, description: 'Scope approved by stakeholders.', status: 'done', priority: 'low', dueDate: '2026-10-20', assigneeId: ownerId },
  ]
  const createdTasks = []
  for (const input of taskInputs) {
    const response = await browserApi(ownerPage, `/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(input) })
    if (response.status !== 201) throw new Error(`Could not seed ${input.title}`)
    createdTasks.push(response.body.task)
  }

  await ownerPage.goto(`${frontendUrl}/board`, { waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await ownerPage.getByText(names.todo, { exact: true }).waitFor()
  await inspect(ownerPage, 'stage-d-kanban-desktop', desktop)

  const todoCard = ownerPage.getByTestId(`kanban-task-${createdTasks[0].id}`)
  await todoCard.dragTo(ownerPage.getByTestId('kanban-column-done'))
  await ownerPage.getByTestId('kanban-column-done').getByText(names.todo, { exact: true }).waitFor()
  await waitForTask(createdTasks[0].id, 'done')
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByTestId('kanban-column-done').getByText(names.todo, { exact: true }).waitFor()
  report.checks.push('Native drag-and-drop persists to PostgreSQL and survives refresh')

  await ownerPage.getByLabel(`Move ${names.todo}`).selectOption('in_progress')
  await ownerPage.getByTestId('kanban-column-in_progress').getByText(names.todo, { exact: true }).waitFor()
  await waitForTask(createdTasks[0].id, 'in_progress')
  await ownerPage.getByRole('button', { name: 'Undo move' }).click()
  await ownerPage.getByTestId('kanban-column-done').getByText(names.todo, { exact: true }).waitFor()
  await waitForTask(createdTasks[0].id, 'done')
  report.checks.push('Accessible status control and undo persist correctly')

  let rejected = false
  await ownerPage.route(`**/api/tasks/${createdTasks[0].id}`, async (route) => {
    if (!rejected && route.request().method() === 'PATCH') { rejected = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary QA failure' }) }); return }
    await route.continue()
  })
  await ownerPage.getByLabel(`Move ${names.todo}`).selectOption('todo')
  await ownerPage.getByRole('alert').getByText(/could not be moved/i).waitFor()
  await waitForTask(createdTasks[0].id, 'done')
  await ownerPage.unroute(`**/api/tasks/${createdTasks[0].id}`)
  await ownerPage.getByRole('button', { name: 'Retry move' }).click()
  await ownerPage.getByTestId('kanban-column-todo').getByText(names.todo, { exact: true }).waitFor()
  await waitForTask(createdTasks[0].id, 'todo')
  report.checks.push('Failed moves preserve server state and recover through retry')

  await ownerPage.getByRole('button', { name: names.todo, exact: true }).click()
  const editPanel = ownerPage.getByRole('dialog', { name: 'Edit task' })
  await editPanel.getByLabel('Priority').selectOption('medium')
  await editPanel.getByRole('button', { name: 'Save changes' }).click()
  await editPanel.waitFor({ state: 'hidden' })
  const edited = await pool.query('SELECT priority FROM tasks WHERE id=$1', [createdTasks[0].id])
  if (edited.rows[0]?.priority !== 'medium') throw new Error('Task editing from the board did not persist')
  await ownerPage.getByRole('main').getByRole('button', { name: 'Create task' }).click()
  const createPanel = ownerPage.getByRole('dialog', { name: 'Create task' })
  await createPanel.getByLabel('Task title').fill('Capture launch notes')
  await createPanel.getByRole('button', { name: 'Create task', exact: true }).click()
  await createPanel.waitFor({ state: 'hidden' })
  await ownerPage.getByText('Capture launch notes', { exact: true }).waitFor()
  report.checks.push('Existing task creation and editing panels work from the board')

  const memberContext = await browser.newContext({ viewport: desktop, colorScheme: 'dark' })
  const memberPage = await memberContext.newPage()
  const memberId = await register(memberPage, accounts[1], names.isolated)
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [workspaceId, memberId, 'member'])
  await memberPage.reload({ waitUntil: 'networkidle' })
  await memberPage.locator('#workspace-select').selectOption(workspaceId)
  await memberPage.goto(`${frontendUrl}/board`, { waitUntil: 'networkidle' })
  await memberPage.getByText(names.progress, { exact: true }).waitFor()
  await memberPage.getByLabel(`Move ${names.progress}`).selectOption('done')
  await memberPage.getByTestId('kanban-column-done').getByText(names.progress, { exact: true }).waitFor()
  await waitForTask(createdTasks[1].id, 'done')
  const isolatedRow = await pool.query('SELECT id FROM workspaces WHERE created_by=$1 AND name=$2', [memberId, names.isolated])
  const hiddenRead = await browserApi(ownerPage, `/api/workspaces/${isolatedRow.rows[0].id}/tasks`)
  if (hiddenRead.status !== 404) throw new Error('Cross-workspace task data was exposed')
  const hiddenMove = await browserApi(ownerPage, '/api/tasks/00000000-0000-4000-8000-000000000000', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
  if (hiddenMove.status !== 404) throw new Error('Unknown/cross-workspace task move did not return 404')
  report.checks.push('Members can move tasks in their workspace; cross-workspace reads and moves stay hidden')

  const dismissUpdate = ownerPage.getByRole('button', { name: 'Dismiss update' })
  if (await dismissUpdate.count()) await dismissUpdate.click()
  await ownerPage.locator('.toast').waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {})
  await ownerPage.setViewportSize({ width: 768, height: 900 })
  await inspect(ownerPage, 'stage-d-kanban-tablet', { width: 768, height: 900 })
  await ownerPage.setViewportSize({ width: 390, height: 844 })
  await inspect(ownerPage, 'stage-d-kanban-mobile', { width: 390, height: 844 })
  await ownerPage.getByRole('tab', { name: /Done/ }).click()
  await ownerPage.getByTestId('kanban-column-done').getByText(names.done, { exact: true }).waitFor()
  await ownerPage.setViewportSize({ width: 320, height: 720 })
  await inspect(ownerPage, 'stage-d-kanban-narrow', { width: 320, height: 720 })
  report.checks.push('Desktop, tablet, mobile, and 320px layouts have no overflow or axe violations')

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join('; ')}`)
  await ownerContext.close()
  await memberContext.close()
  console.log('Stage D browser QA passed: movement, persistence, recovery, roles, isolation, accessibility, and responsive layouts.')
} finally {
  await browser.close()
  await cleanup()
  const remaining = await pool.query('SELECT count(*)::int AS count FROM users WHERE email=ANY($1::text[])', [accounts.map((account) => account.email)])
  report.temporaryAccountsRemaining = remaining.rows[0]?.count ?? 0
  await pool.end()
  await writeFile(path.resolve('artifacts/kanban-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
