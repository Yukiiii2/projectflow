import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import dotenv from 'dotenv'
import session from 'express-session'
import { chromium, type Browser, type Page } from 'playwright-core'
import { Pool } from 'pg'
import { createApp } from '../app.js'
import { createIsolatedEmailQaDatabase, type IsolatedEmailQaDatabase } from './email-browser-helpers.test-support.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function reservePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address === 'object', 'Could not reserve a browser QA port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function monitor(page: Page, failures: string[]) {
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) failures.push(`console: ${message.text()}`) })
  page.on('response', (response) => { if (response.status() >= 500) failures.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`) })
}

async function enterDemo(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Try Demo' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await page.getByText('Private demo workspace', { exact: true }).waitFor()
}

const localEnvPath = process.env.PROJECTFLOW_LOCAL_ENV_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url))
dotenv.config({ path: localEnvPath })
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'A local DATABASE_URL is required for demo browser QA')
const staticAssetsPath = fileURLToPath(new URL('../../../dist/', import.meta.url))
await access(fileURLToPath(new URL('../../../dist/index.html', import.meta.url)))
const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await access(edgePath)

let qaDatabase: IsolatedEmailQaDatabase | undefined
let browser: Browser | undefined
let httpServer: ReturnType<ReturnType<typeof createApp>['listen']> | undefined
const failures: string[] = []

try {
  qaDatabase = await createIsolatedEmailQaDatabase(databaseUrl)
  const { pool } = qaDatabase
  const port = await reservePort()
  const origin = `http://127.0.0.1:${port}`
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    staticAssetsPath,
    config: {
      frontendOrigin: origin,
      sessionSecret: 'demo-browser-qa-session-secret-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      demoModeEnabled: true,
    },
  })
  httpServer = app.listen(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { httpServer!.once('listening', resolve); httpServer!.once('error', reject) })

  browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const firstContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin, colorScheme: 'dark' })
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: origin, colorScheme: 'light' })
  const firstPage = await firstContext.newPage()
  const secondPage = await secondContext.newPage()
  monitor(firstPage, failures)
  monitor(secondPage, failures)

  await enterDemo(firstPage)
  await enterDemo(secondPage)
  const identities = await pool.query<{ id: string; demo_instance_id: string; workspace_id: string }>(`SELECT u.id,u.demo_instance_id,w.id AS workspace_id
    FROM users u JOIN workspaces w ON w.demo_instance_id=u.demo_instance_id WHERE u.name='Demo Visitor' ORDER BY u.created_at`)
  assert(identities.rows.length === 2, 'Each browser did not receive one visitor identity')
  assert(identities.rows[0]!.demo_instance_id !== identities.rows[1]!.demo_instance_id, 'Browser sessions shared a demo instance')
  assert(identities.rows[0]!.workspace_id !== identities.rows[1]!.workspace_id, 'Browser sessions shared a workspace')

  const isolated = await firstPage.evaluate(async (workspaceId) => (await fetch(`/api/workspaces/${workspaceId}/projects`, { credentials: 'include' })).status, identities.rows[1]!.workspace_id)
  assert(isolated === 404, 'A demo visitor could read another visitor workspace')
  assert(await firstPage.getByRole('button', { name: 'Create workspace' }).count() === 0, 'Demo exposed workspace creation')

  const accessibility = await new AxeBuilder({ page: firstPage }).analyze()
  const seriousViolations = accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  assert(seriousViolations.length === 0, `Dashboard accessibility violations: ${seriousViolations.map((violation) => `${violation.id} (${violation.nodes.map((node) => `${node.target.join(' ')}: ${node.html}; ${node.failureSummary}`).join(', ')})`).join('; ')}`)

  await firstPage.goto('/board', { waitUntil: 'networkidle' })
  await firstPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await firstPage.getByLabel('Move Publish launch checklist').selectOption('in_progress')
  await firstPage.getByText('Publish launch checklist moved to In progress.').waitFor()
  const moved = await pool.query<{ status: string }>("SELECT status FROM tasks WHERE title='Publish launch checklist' AND project_id IN (SELECT id FROM projects WHERE workspace_id=$1)", [identities.rows[0]!.workspace_id])
  assert(moved.rows[0]?.status === 'in_progress', 'Kanban move did not persist')

  await firstPage.getByRole('button', { name: 'Finalize responsive homepage' }).click()
  const taskDialog = firstPage.getByRole('dialog', { name: 'Edit task' })
  await taskDialog.getByLabel('Task title').fill('Finalize responsive homepage — reviewed')
  await taskDialog.getByRole('button', { name: 'Save changes' }).click()
  await firstPage.getByRole('button', { name: 'Finalize responsive homepage — reviewed' }).click()
  const reopened = firstPage.getByRole('dialog', { name: 'Edit task' })
  await reopened.getByRole('tab', { name: 'Comments' }).click()
  await reopened.getByLabel('Add a comment').fill('Demo collaboration note from the visitor.')
  await reopened.getByRole('button', { name: 'Post comment' }).click()
  await reopened.getByText('Demo collaboration note from the visitor.').waitFor()
  await reopened.getByRole('button', { name: 'Close edit task' }).click()
  const persisted = await pool.query<{ title: string; comments: number }>(`SELECT t.title,(SELECT count(*)::int FROM comments c WHERE c.task_id=t.id) AS comments
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.workspace_id=$1 AND t.title=$2`, [identities.rows[0]!.workspace_id, 'Finalize responsive homepage — reviewed'])
  assert(persisted.rows[0]?.comments === 2, 'Task edit or comment did not persist in the demo workspace')

  await firstPage.goto('/team', { waitUntil: 'networkidle' })
  await firstPage.getByRole('heading', { name: 'Team' }).waitFor()
  assert(await firstPage.getByRole('button', { name: 'Invite member' }).count() === 0, 'Demo exposed invitation delivery')
  assert(await firstPage.getByLabel(/^Role for /).count() === 0, 'Demo exposed member role controls')

  await secondPage.getByText('Private demo workspace', { exact: true }).waitFor()
  const overflow = await secondPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(overflow <= 1, `Mobile demo layout overflowed by ${overflow}px`)

  await pool.query('UPDATE demo_instances SET expires_at=now() WHERE id=$1', [identities.rows[0]!.demo_instance_id])
  await firstPage.reload({ waitUntil: 'networkidle' })
  await firstPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  assert((await pool.query('SELECT id FROM demo_instances WHERE id=$1', [identities.rows[0]!.demo_instance_id])).rows.length === 0, 'Expired demo records were not cleaned')

  await secondPage.getByRole('button', { name: 'Open navigation drawer' }).click()
  await secondPage.getByRole('button', { name: 'Sign out' }).click()
  await secondPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  assert((await pool.query('SELECT id FROM demo_instances')).rows.length === 0, 'Logout left demo records behind')
  assert(failures.length === 0, `Browser failures: ${failures.join('; ')}`)

  await firstContext.close()
  await secondContext.close()
  console.log(JSON.stringify({ status: 'passed', checks: ['isolated identities and workspaces', 'real API persistence', 'Kanban movement', 'task editing', 'comments', 'privilege restrictions', '30-minute expiry cleanup', 'logout cleanup', 'responsive mobile layout', 'critical accessibility scan'] }))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  const schema = qaDatabase?.schema
  if (qaDatabase) await qaDatabase.dispose()
  if (schema) {
    const verifier = new Pool({ connectionString: databaseUrl })
    try {
      const remaining = await verifier.query<{ exists: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS exists', [schema])
      assert(!remaining.rows[0]?.exists, 'Disposable demo QA schema remained after cleanup')
    } finally { await verifier.end() }
  }
}
