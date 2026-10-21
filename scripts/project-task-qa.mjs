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
  { name: 'Stage C Owner', email: `stage-c-owner-${runId}@example.invalid` },
  { name: 'Stage C Member', email: `stage-c-member-${runId}@example.invalid` },
]
const names = { workspace: `Stage C Workspace ${runId.slice(0, 6)}`, isolated: `Stage C Isolated ${runId.slice(0, 6)}`, project: 'Client delivery portal', renamed: 'Client delivery workspace', task: 'Prepare launch checklist' }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const report = { frontendUrl, generatedAt: new Date().toISOString(), checks: [], screenshots: [], temporaryAccountsRemaining: 0 }
await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  await page.waitForTimeout(250)
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const layout = await page.evaluate(() => ({
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    outOfBounds: [...document.querySelectorAll('button,a,input,select,textarea,h1,h2,p')].filter((node) => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node)
      return style.display !== 'none' && rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
    }).map((node) => node.textContent?.trim().slice(0, 50)).slice(0, 8),
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
    const response = await fetch(url, { ...request, credentials: 'include' })
    return { status: response.status, body: response.status === 204 ? null : await response.json() }
  }, { url: `${apiUrl}${pathname}`, request: init })
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
  const desktopViewport = { width: 1440, height: 1000 }
  const ownerContext = await browser.newContext({ viewport: desktopViewport, colorScheme: 'dark' })
  const ownerPage = await ownerContext.newPage()
  const browserErrors = []
  ownerPage.on('pageerror', (error) => browserErrors.push(error.message))
  ownerPage.on('response', (response) => { if (response.status() >= 500) browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`) })
  const ownerId = await register(ownerPage, accounts[0], names.workspace)
  const workspace = await pool.query('SELECT id FROM workspaces WHERE created_by=$1 AND name=$2', [ownerId, names.workspace])
  const workspaceId = workspace.rows[0].id

  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await ownerPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await inspect(ownerPage, 'stage-c-projects-desktop', desktopViewport)
  await ownerPage.getByRole('button', { name: 'Create project' }).click()
  const projectDialog = ownerPage.getByRole('dialog', { name: 'Create project' })
  await projectDialog.getByLabel('Project name').fill(names.project)
  await projectDialog.getByLabel('Description').fill('A focused portal launch for a retained client.')
  await projectDialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await ownerPage.getByRole('link', { name: `Open ${names.project} project` }).click()
  await ownerPage.getByRole('heading', { name: names.project }).waitFor()

  const projectRow = await pool.query('SELECT id FROM projects WHERE workspace_id=$1 AND name=$2', [workspaceId, names.project])
  const projectId = projectRow.rows[0].id
  await ownerPage.getByRole('main').getByRole('button', { name: 'Create task' }).click()
  const taskPanel = ownerPage.getByRole('dialog', { name: 'Create task' })
  await taskPanel.getByLabel('Task title').fill(names.task)
  await taskPanel.getByLabel('Description').fill('Confirm scope, owner, and launch readiness.')
  await taskPanel.getByLabel('Assignee').selectOption(ownerId)
  await taskPanel.getByLabel('Priority').selectOption('high')
  await taskPanel.getByLabel('Status').selectOption('in_progress')
  await taskPanel.getByLabel('Due date').fill('2026-10-27')
  await taskPanel.getByRole('button', { name: 'Create task', exact: true }).click()
  await ownerPage.getByText(names.task, { exact: true }).waitFor()
  await ownerPage.getByText('Oct 27, 2026', { exact: true }).first().waitFor()
  await inspect(ownerPage, 'stage-c-project-detail-desktop', desktopViewport)

  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Dashboard' }).click()
  await ownerPage.getByTestId('active-projects-value').waitFor()
  if ((await ownerPage.getByTestId('active-projects-value').textContent())?.trim() !== '1') throw new Error('Dashboard active project count was not database-backed')
  if ((await ownerPage.getByTestId('tasks-completed-value').textContent())?.trim() !== '0 / 1') throw new Error('Dashboard task totals were not database-backed')
  if ((await ownerPage.getByTestId('due-this-week-value').textContent())?.trim() !== '1') throw new Error('Dashboard due-this-week count was not database-backed')
  if ((await ownerPage.getByTestId('overdue-tasks-value').textContent())?.trim() !== '0') throw new Error('Dashboard overdue count was not database-backed')
  report.checks.push('Dashboard metrics reflect PostgreSQL project and task records')
  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await ownerPage.getByRole('link', { name: `Open ${names.project} project` }).click()

  await ownerPage.getByRole('button', { name: 'Edit project' }).click()
  const editDialog = ownerPage.getByRole('dialog', { name: 'Edit project' })
  await editDialog.getByLabel('Project name').fill(names.renamed)
  await editDialog.getByRole('button', { name: 'Save changes' }).click()
  await ownerPage.getByRole('heading', { name: names.renamed }).waitFor()
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: names.renamed }).waitFor()
  await ownerPage.getByText(names.task, { exact: true }).waitFor()
  report.checks.push('Owner project/task create, edit, persistence after refresh')

  await ownerPage.getByText(names.task, { exact: true }).click()
  const editTaskPanel = ownerPage.getByRole('dialog', { name: 'Edit task' })
  await editTaskPanel.getByLabel('Status').selectOption('done')
  await editTaskPanel.getByRole('button', { name: 'Save changes' }).click()
  await editTaskPanel.waitFor({ state: 'hidden' })
  const taskRow = await pool.query('SELECT status,priority,due_date::text,assignee_id FROM tasks WHERE project_id=$1 AND title=$2', [projectId, names.task])
  if (taskRow.rows[0]?.status !== 'done' || taskRow.rows[0]?.priority !== 'high' || taskRow.rows[0]?.due_date !== '2026-10-27' || taskRow.rows[0]?.assignee_id !== ownerId) throw new Error(`Task changes were not persisted: ${JSON.stringify(taskRow.rows[0])}`)
  report.checks.push('Assignment, priority, date-only due date, and status persistence')
  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Dashboard' }).click()
  await ownerPage.getByTestId('tasks-completed-value').waitFor()
  if ((await ownerPage.getByTestId('tasks-completed-value').textContent())?.trim() !== '1 / 1') throw new Error('Dashboard completion total did not update')
  if ((await ownerPage.getByTestId('due-this-week-value').textContent())?.trim() !== '0') throw new Error('Completed task remained in the due-this-week total')
  await ownerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await ownerPage.getByRole('link', { name: `Open ${names.renamed} project` }).click()

  const memberContext = await browser.newContext({ viewport: desktopViewport, colorScheme: 'dark' })
  const memberPage = await memberContext.newPage()
  const memberId = await register(memberPage, accounts[1], names.isolated)
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [workspaceId, memberId, 'member'])
  await memberPage.reload({ waitUntil: 'networkidle' })
  await memberPage.locator('#workspace-select').selectOption(workspaceId)
  await memberPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Projects' }).click()
  await memberPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  if (await memberPage.getByRole('button', { name: 'Create project' }).count()) throw new Error('Member saw project creation control')
  await memberPage.getByRole('link', { name: `Open ${names.renamed} project` }).click()
  if (await memberPage.getByRole('button', { name: 'Edit project' }).count()) throw new Error('Member saw project edit control')
  const forbidden = await browserApi(memberPage, `/api/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Forbidden rename' }) })
  if (forbidden.status !== 403) throw new Error('Member project edit was not rejected')
  await memberPage.getByRole('main').getByRole('button', { name: 'Create task' }).click()
  await memberPage.getByRole('dialog', { name: 'Create task' }).getByLabel('Task title').fill('Member-owned follow-up')
  await memberPage.getByRole('dialog', { name: 'Create task' }).getByRole('button', { name: 'Create task', exact: true }).click()
  await memberPage.getByText('Member-owned follow-up', { exact: true }).waitFor()
  report.checks.push('Member project permissions and allowed task creation')

  const isolatedWorkspace = await pool.query('SELECT id FROM workspaces WHERE created_by=$1 AND name=$2', [memberId, names.isolated])
  const hidden = await browserApi(ownerPage, `/api/workspaces/${isolatedWorkspace.rows[0].id}/projects`)
  if (hidden.status !== 404) throw new Error('Cross-workspace project data was exposed')
  report.checks.push('Cross-workspace reads return 404')

  await memberPage.setViewportSize({ width: 390, height: 844 })
  await inspect(memberPage, 'stage-c-project-detail-mobile', { width: 390, height: 844 })
  await memberPage.setViewportSize({ width: 320, height: 720 })
  await inspect(memberPage, 'stage-c-project-detail-narrow', { width: 320, height: 720 })

  await ownerPage.getByRole('button', { name: 'Edit project' }).click()
  await ownerPage.getByRole('dialog', { name: 'Edit project' }).getByRole('button', { name: 'Archive project' }).click()
  await ownerPage.getByRole('button', { name: 'Confirm archive' }).click()
  await ownerPage.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await ownerPage.reload({ waitUntil: 'networkidle' })
  if (await ownerPage.getByText(names.renamed, { exact: true }).count()) throw new Error('Archived project remained visible')
  report.checks.push('Project archive persists after refresh')

  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join('; ')}`)
  await ownerContext.close(); await memberContext.close()
  console.log('Stage C browser QA passed: project/task persistence, roles, isolation, accessibility, and responsive layouts.')
} finally {
  await browser.close()
  await cleanup()
  const remaining = await pool.query('SELECT count(*)::int AS count FROM users WHERE email=ANY($1::text[])', [accounts.map((account) => account.email)])
  report.temporaryAccountsRemaining = remaining.rows[0]?.count ?? 0
  await pool.end()
  await writeFile(path.resolve('artifacts/project-task-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
