import { access, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import dotenv from 'dotenv'
import session from 'express-session'
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright-core'
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
  assert(address && typeof address === 'object', 'Could not reserve a final portfolio QA port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

interface BrowserEvidence {
  consoleErrors: string[]
  pageErrors: string[]
  networkErrors: Array<{ status: number; path: string }>
  sensitiveResponses: string[]
  scans: Promise<void>[]
}

function evidence(): BrowserEvidence {
  return { consoleErrors: [], pageErrors: [], networkErrors: [], sensitiveResponses: [], scans: [] }
}

function monitor(page: Page, label: string, result: BrowserEvidence) {
  page.on('pageerror', (error) => result.pageErrors.push(`${label}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) result.consoleErrors.push(`${label}: ${message.text()}`)
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (response.status() >= 400) result.networkErrors.push({ status: response.status(), path: url.pathname })
    if (!url.pathname.startsWith('/api/') || !response.headers()['content-type']?.includes('application/json')) return
    result.scans.push(scanSensitiveResponse(response, label, result))
  })
}

async function scanSensitiveResponse(response: Response, label: string, result: BrowserEvidence) {
  const body = await response.text().catch(() => '')
  if (!body) return
  const containsSensitiveKey = /"(?:password|token|secret|authorization|api[_-]?key)"\s*:/i.test(body)
  const containsBearer = /\bBearer\s+[A-Za-z0-9._~-]{12,}/i.test(body)
  const containsCredentialUrl = /postgres(?:ql)?:\/\/[^\s"']+:[^\s@"']+@/i.test(body)
  const containsJwt = /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/.test(body)
  if (containsSensitiveKey || containsBearer || containsCredentialUrl || containsJwt) {
    result.sensitiveResponses.push(`${label}: ${new URL(response.url()).pathname}`)
  }
}

function expectedNetworkError({ status, path }: { status: number; path: string }) {
  if (status === 401 && ['/api/auth/me', '/api/auth/login', '/api/workspaces'].includes(path)) return true
  if (status === 404 && (path === '/api/auth/demo' || /^\/api\/workspaces\/[^/]+\/projects$/.test(path))) return true
  if (status === 403 && (path === '/api/workspaces' || /\/invitations$/.test(path) || /\/members\/[^/]+$/.test(path))) return true
  if (status === 429 && path === '/api/auth/demo') return true
  if (status === 503 && ['/api/auth/register', '/api/auth/password-reset/request'].includes(path)) return true
  return false
}

async function startLocalApp(pool: Pool, staticAssetsPath: string, demoModeEnabled: boolean, portfolioModeEnabled = false) {
  const port = await reservePort()
  const origin = `http://127.0.0.1:${port}`
  const app = createApp({
    db: pool,
    sessionStore: new session.MemoryStore(),
    staticAssetsPath,
    config: {
      frontendOrigin: origin,
      sessionSecret: `final-portfolio-qa-${demoModeEnabled ? 'enabled' : 'disabled'}-${portfolioModeEnabled ? 'portfolio' : 'normal'}-session-secret`,
      production: false,
      requireEmailVerification: true,
      demoModeEnabled,
      portfolioModeEnabled,
    },
  })
  const server = app.listen(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  return { origin, server }
}

async function decodePreviews(page: Page) {
  const previews = page.locator('.landing-page img')
  for (let index = 0; index < await previews.count(); index += 1) {
    const image = previews.nth(index)
    await image.scrollIntoViewIfNeeded()
    await image.evaluate(async (element) => { await (element as HTMLImageElement).decode() })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  return previews.evaluateAll((images) => images.every((image) => {
    const element = image as HTMLImageElement
    return element.complete && element.naturalWidth > 0
  }))
}

async function accessibility(page: Page, label: string) {
  const report = await new AxeBuilder({ page }).analyze()
  const serious = report.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  assert(serious.length === 0, `${label} accessibility violations: ${serious.map((violation) => violation.id).join(', ')}`)
}

async function captureLanding(page: Page, label: string, screenshotPath: string) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Bring clarity to every project.' }).waitFor()
  assert(await decodePreviews(page), `${label} preview images did not decode`)
  for (const heading of ['See ProjectFlow in action.', 'Everything your team needs to move work forward.', 'A clear path from idea to done.', 'Your private workspace is ready when you are.']) {
    await page.getByRole('heading', { name: heading }).waitFor()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(overflow <= 1, `${label} landing page overflowed by ${overflow}px`)
  await accessibility(page, label)

  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!)
    return { tag: document.activeElement?.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
  })
  assert(focus.tag === 'A' && focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px', `${label} first keyboard target had no visible focus outline`)

  if (page.viewportSize()!.width <= 900) {
    const trigger = page.getByRole('button', { name: 'Open navigation' })
    await trigger.click()
    const close = page.getByRole('button', { name: 'Close navigation' })
    await close.waitFor({ state: 'visible' })
    assert(await close.evaluate((element) => element === document.activeElement), `${label} mobile menu did not move focus to Close navigation`)
    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: 'Mobile' }).waitFor({ state: 'detached' })
    assert(await trigger.evaluate((element) => element === document.activeElement), `${label} mobile menu did not restore trigger focus`)
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
}

async function apiStatus(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(async ({ requestPath, method, body }) => {
    const response = await fetch(requestPath, {
      method: method ?? 'GET',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return response.status
  }, { requestPath: path, method: init.method, body: init.body })
}

async function startDemoFromLanding(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Try Live Demo' }).first().click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await page.locator('.dashboard-overview').waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dashboard-overview')!).opacity === '1')
  await page.getByText('Private demo workspace', { exact: true }).waitFor()
}

const localEnvPath = process.env.PROJECTFLOW_LOCAL_ENV_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url))
dotenv.config({ path: localEnvPath })
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'A local DATABASE_URL is required for final portfolio QA')
const staticAssetsPath = fileURLToPath(new URL('../../../dist/', import.meta.url))
await access(fileURLToPath(new URL('../../../dist/index.html', import.meta.url)))
const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await access(edgePath)
const artifactDirectory = process.env.FINAL_PORTFOLIO_QA_ARTIFACT_DIR ?? fileURLToPath(new URL('../../../.superpowers/sdd/2026-10-28-final-portfolio-qa/browser-qa/', import.meta.url))
await mkdir(artifactDirectory, { recursive: true })

let qaDatabase: IsolatedEmailQaDatabase | undefined
let browser: Browser | undefined
let enabledServer: Awaited<ReturnType<typeof startLocalApp>>['server'] | undefined
let disabledServer: Awaited<ReturnType<typeof startLocalApp>>['server'] | undefined
let portfolioServer: Awaited<ReturnType<typeof startLocalApp>>['server'] | undefined
const browserEvidence = evidence()
const contexts: BrowserContext[] = []

try {
  qaDatabase = await createIsolatedEmailQaDatabase(databaseUrl)
  const { pool } = qaDatabase
  const disabled = await startLocalApp(pool, staticAssetsPath, false)
  const enabled = await startLocalApp(pool, staticAssetsPath, true)
  const portfolio = await startLocalApp(pool, staticAssetsPath, true, true)
  disabledServer = disabled.server
  enabledServer = enabled.server
  portfolioServer = portfolio.server
  browser = await chromium.launch({ executablePath: edgePath, headless: true })

  const viewportMatrix = [
    { label: 'landing-1920', width: 1920, height: 1080 },
    { label: 'landing-1440', width: 1440, height: 1000 },
    { label: 'landing-1024', width: 1024, height: 768 },
    { label: 'landing-768', width: 768, height: 1024 },
    { label: 'landing-390', width: 390, height: 844 },
    { label: 'landing-320', width: 320, height: 700 },
  ]
let performanceMetrics: { domContentLoadedMs: number; loadMs: number; firstContentfulPaintMs: number; encodedResourcesKb: number } | undefined

  for (const viewport of viewportMatrix) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, baseURL: enabled.origin, colorScheme: 'dark' })
    contexts.push(context)
    const page = await context.newPage()
    monitor(page, viewport.label, browserEvidence)
    await captureLanding(page, viewport.label, join(artifactDirectory, `${viewport.label}.png`))

    if (viewport.width === 1440) {
      await page.getByRole('link', { name: 'Features' }).first().click()
      await page.waitForFunction(() => location.hash === '#features' && Math.abs(document.querySelector('#features')!.getBoundingClientRect().top) < 160)
      await page.getByRole('link', { name: 'How It Works' }).first().click()
      await page.waitForFunction(() => location.hash === '#how-it-works' && Math.abs(document.querySelector('#how-it-works')!.getBoundingClientRect().top) < 160)
      await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click()
      await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
      await page.goBack({ waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Bring clarity to every project.' }).waitFor()
      performanceMetrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        const paint = performance.getEntriesByName('first-contentful-paint')[0]
        const encoded = performance.getEntriesByType('resource').reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).encodedBodySize || 0), 0)
        return {
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
          loadMs: Math.round(navigation.loadEventEnd),
          firstContentfulPaintMs: Math.round(paint?.startTime ?? 0),
          encodedResourcesKb: Math.round(encoded / 1024),
        }
      })
      assert(performanceMetrics.loadMs < 3_000 && performanceMetrics.firstContentfulPaintMs < 2_500, `Local landing load was unexpectedly slow: ${JSON.stringify(performanceMetrics)}`)
    }
    await context.close()
    contexts.splice(contexts.indexOf(context), 1)
  }

  const reducedContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, baseURL: enabled.origin, reducedMotion: 'reduce' })
  contexts.push(reducedContext)
  const reducedPage = await reducedContext.newPage()
  monitor(reducedPage, 'reduced-motion', browserEvidence)
  await reducedPage.goto('/', { waitUntil: 'networkidle' })
  const reduced = await reducedPage.locator('.landing-hero__copy').evaluate((element) => ({
    animationDuration: Number.parseFloat(getComputedStyle(element).animationDuration),
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
  }))
  assert(reduced.animationDuration <= 0.001 && reduced.scrollBehavior === 'auto', `Reduced motion was not respected: ${JSON.stringify(reduced)}`)
  await reducedContext.close()
  contexts.splice(contexts.indexOf(reducedContext), 1)

  const disabledContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: disabled.origin, colorScheme: 'dark' })
  contexts.push(disabledContext)
  const disabledPage = await disabledContext.newPage()
  monitor(disabledPage, 'demo-disabled', browserEvidence)
  await disabledPage.goto('/', { waitUntil: 'networkidle' })
  const disabledDemoButton = disabledPage.getByRole('button', { name: 'Demo unavailable' }).first()
  await disabledDemoButton.waitFor()
  assert(await disabledDemoButton.isDisabled(), 'Disabled demo action remained interactive')
  assert(await disabledPage.getByRole('heading', { name: 'Bring clarity to every project.' }).isVisible(), 'Disabled demo left the landing page')
  await disabledPage.screenshot({ path: join(artifactDirectory, '07-demo-disabled.png'), fullPage: true })
  await disabledContext.close()
  contexts.splice(contexts.indexOf(disabledContext), 1)

  const portfolioContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: portfolio.origin, colorScheme: 'dark' })
  contexts.push(portfolioContext)
  const portfolioPage = await portfolioContext.newPage()
  monitor(portfolioPage, 'portfolio-policy', browserEvidence)
  await portfolioPage.goto('/', { waitUntil: 'networkidle' })
  await portfolioPage.getByText(/Portfolio mode: new accounts and email-based recovery are unavailable/i).waitFor()
  assert(await portfolioPage.getByRole('link', { name: 'Create an account' }).count() === 0, 'Portfolio landing exposed account creation')
  assert(await portfolioPage.getByRole('button', { name: 'Try Live Demo' }).first().isEnabled(), 'Portfolio landing disabled the live demo')
  await portfolioPage.goto('/register', { waitUntil: 'networkidle' })
  await portfolioPage.getByRole('heading', { name: 'Registration unavailable' }).waitFor()
  assert(await portfolioPage.getByRole('button', { name: 'Create account' }).count() === 0, 'Portfolio registration form remained available')
  await portfolioPage.goto('/forgot-password', { waitUntil: 'networkidle' })
  await portfolioPage.getByRole('heading', { name: 'Password recovery unavailable' }).waitFor()
  assert(await portfolioPage.getByRole('button', { name: 'Send reset link' }).count() === 0, 'Portfolio recovery form remained available')
  assert(await apiStatus(portfolioPage, '/api/auth/register', { method: 'POST', body: { name: 'Blocked User', email: 'blocked@example.test', password: 'blocked correct horse battery staple' } }) === 503, 'Portfolio registration API was not blocked')
  assert(await apiStatus(portfolioPage, '/api/auth/password-reset/request', { method: 'POST', body: { email: 'blocked@example.test' } }) === 503, 'Portfolio recovery API was not blocked')
  await portfolioPage.screenshot({ path: join(artifactDirectory, '08-portfolio-policy.png'), fullPage: true })
  await portfolioContext.close()
  contexts.splice(contexts.indexOf(portfolioContext), 1)

  const journeyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: enabled.origin, colorScheme: 'dark' })
  contexts.push(journeyContext)
  const journeyPage = await journeyContext.newPage()
  monitor(journeyPage, 'visitor-journey', browserEvidence)
  await startDemoFromLanding(journeyPage)
  await journeyPage.screenshot({ path: join(artifactDirectory, '08-demo-dashboard.png'), fullPage: true })

  const primaryIdentity = (await pool.query<{ id: string; demo_instance_id: string; workspace_id: string }>(`SELECT u.id,u.demo_instance_id,w.id AS workspace_id
    FROM users u JOIN workspaces w ON w.demo_instance_id=u.demo_instance_id WHERE u.demo_instance_id IS NOT NULL ORDER BY u.created_at LIMIT 1`)).rows[0]
  assert(primaryIdentity, 'Primary demo identity was not created')

  const realUser = (await pool.query<{ id: string }>("INSERT INTO users(name,email,password_hash) VALUES ('Local QA User','local.qa@example.invalid','not-a-login-hash') RETURNING id")).rows[0]!
  const realWorkspace = (await pool.query<{ id: string }>("INSERT INTO workspaces(name,created_by) VALUES ('Local QA Real Workspace',$1) RETURNING id", [realUser.id])).rows[0]!
  await pool.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [realWorkspace.id, realUser.id])

  await journeyPage.getByRole('button', { name: 'Projects' }).first().click()
  await journeyPage.getByRole('heading', { name: 'Projects' }).waitFor()
  await journeyPage.screenshot({ path: join(artifactDirectory, '09-projects.png'), fullPage: true })
  await journeyPage.getByRole('link', { name: /Open Website Launch project/ }).click()
  await journeyPage.getByRole('heading', { name: 'Website Launch' }).waitFor()
  await journeyPage.getByRole('button', { name: 'Create task' }).click()
  const createTask = journeyPage.getByRole('dialog', { name: 'Create task' })
  await createTask.getByLabel('Task title').fill('Portfolio QA launch task')
  await createTask.getByLabel('Description').fill('Validate the final portfolio journey before deployment.')
  await createTask.getByLabel('Status').selectOption('todo')
  await createTask.getByLabel('Priority').selectOption('high')
  await createTask.getByLabel('Assignee').selectOption({ label: 'Alex Morgan' })
  await createTask.getByRole('button', { name: 'Create task', exact: true }).click()
  await createTask.waitFor({ state: 'hidden' })
  await journeyPage.getByRole('button', { name: /Portfolio QA launch task/ }).waitFor()

  await journeyPage.getByRole('button', { name: /Portfolio QA launch task/ }).click()
  const editTask = journeyPage.getByRole('dialog', { name: 'Edit task' })
  await editTask.getByLabel('Task title').fill('Portfolio QA launch task — reviewed')
  await editTask.getByLabel('Status').selectOption('in_progress')
  await editTask.getByLabel('Assignee').selectOption({ label: 'Priya Shah' })
  await editTask.getByRole('button', { name: 'Save changes' }).click()
  await editTask.waitFor({ state: 'hidden' })
  await journeyPage.getByRole('button', { name: /Portfolio QA launch task — reviewed/ }).waitFor()
  await journeyPage.getByRole('button', { name: /Portfolio QA launch task — reviewed/ }).click()
  const reopenedTask = journeyPage.getByRole('dialog', { name: 'Edit task' })
  assert(await reopenedTask.getByLabel('Status').inputValue() === 'in_progress', 'Edited task status did not persist')
  assert(await reopenedTask.getByLabel('Assignee').locator('option:checked').textContent() === 'Priya Shah', 'Edited task assignee did not persist')

  await reopenedTask.getByRole('tab', { name: 'Comments' }).click()
  await reopenedTask.getByLabel('Add a comment').fill('Initial QA collaboration note.')
  await reopenedTask.getByRole('button', { name: 'Post comment' }).click()
  await reopenedTask.getByText('Initial QA collaboration note.').waitFor()
  await reopenedTask.getByRole('button', { name: 'Edit comment' }).click()
  await reopenedTask.getByRole('textbox', { name: 'Edit comment' }).fill('Updated QA collaboration note.')
  await reopenedTask.getByRole('button', { name: 'Save comment' }).click()
  await reopenedTask.getByText('Updated QA collaboration note.').waitFor()
  await journeyPage.screenshot({ path: join(artifactDirectory, '10-task-comment-edited.png'), fullPage: true })
  journeyPage.once('dialog', (dialog) => void dialog.accept())
  await reopenedTask.getByRole('button', { name: 'Delete comment' }).click()
  await reopenedTask.getByText('Updated QA collaboration note.').waitFor({ state: 'detached' })
  await reopenedTask.getByRole('tab', { name: 'Activity' }).click()
  await reopenedTask.getByText(/created this task|updated this task/).first().waitFor()
  await reopenedTask.getByText('deleted a comment').waitFor()
  await journeyPage.screenshot({ path: join(artifactDirectory, '11-task-activity.png'), fullPage: true })
  await reopenedTask.getByRole('button', { name: 'Close edit task' }).click()

  await journeyPage.goto(`${enabled.origin}/board`, { waitUntil: 'networkidle' })
  await journeyPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await journeyPage.getByLabel('Move Portfolio QA launch task — reviewed').selectOption('done')
  await journeyPage.waitForFunction(() => (document.querySelector('[aria-label="Move Portfolio QA launch task — reviewed"]') as HTMLSelectElement | null)?.value === 'done')
  await journeyPage.reload({ waitUntil: 'networkidle' })
  await journeyPage.getByRole('heading', { name: 'Kanban board' }).waitFor()
  assert(await journeyPage.getByLabel('Move Portfolio QA launch task — reviewed').inputValue() === 'done', 'Kanban status did not survive refresh')
  await journeyPage.screenshot({ path: join(artifactDirectory, '12-kanban-persisted.png'), fullPage: true })

  const taskRow = (await pool.query<{ id: string; status: string; assignee_name: string; comments: number; activity: number }>(`SELECT t.id,t.status,u.name AS assignee_name,
    (SELECT count(*)::int FROM comments c WHERE c.task_id=t.id) AS comments,
    (SELECT count(*)::int FROM activity_events a WHERE a.task_id=t.id) AS activity
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.title=$1`, ['Portfolio QA launch task — reviewed'])).rows[0]
  assert(taskRow?.status === 'done' && taskRow.assignee_name === 'Priya Shah', 'Database task state did not match the browser')
  assert(taskRow.comments === 0 && taskRow.activity >= 5, 'Comment cleanup or task activity history was inconsistent')

  await journeyPage.getByRole('button', { name: 'Dashboard' }).first().click()
  await journeyPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await journeyPage.locator('.dashboard-overview').waitFor()
  assert((await journeyPage.getByTestId('tasks-completed-value').textContent())?.includes('5 / 13'), 'Dashboard completion metric did not reflect the completed QA task')
  await journeyPage.goto('/', { waitUntil: 'networkidle' })
  await journeyPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await journeyPage.screenshot({ path: join(artifactDirectory, '13-authenticated-root.png'), fullPage: true })

  const members = (await pool.query<{ id: string }>('SELECT user_id AS id FROM workspace_members WHERE workspace_id=$1 ORDER BY role DESC', [primaryIdentity.workspace_id])).rows
  const blockedStatuses = {
    otherDemo: 0,
    realWorkspace: await apiStatus(journeyPage, `/api/workspaces/${realWorkspace.id}/projects`),
    createWorkspace: await apiStatus(journeyPage, '/api/workspaces', { method: 'POST', body: { name: 'Blocked workspace' } }),
    listInvitations: await apiStatus(journeyPage, `/api/workspaces/${primaryIdentity.workspace_id}/invitations`),
    createInvitation: await apiStatus(journeyPage, `/api/workspaces/${primaryIdentity.workspace_id}/invitations`, { method: 'POST', body: { email: 'blocked@example.invalid', role: 'member' } }),
    changeMember: await apiStatus(journeyPage, `/api/workspaces/${primaryIdentity.workspace_id}/members/${members[1]!.id}`, { method: 'PATCH', body: { role: 'admin' } }),
  }
  assert(blockedStatuses.realWorkspace === 404 && blockedStatuses.createWorkspace === 403 && blockedStatuses.listInvitations === 403 && blockedStatuses.createInvitation === 403 && blockedStatuses.changeMember === 403, `Demo privilege boundary failed: ${JSON.stringify(blockedStatuses)}`)
  assert(await journeyPage.getByRole('button', { name: 'Create workspace' }).count() === 0, 'Demo UI exposed workspace creation')

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: enabled.origin, colorScheme: 'dark' })
  contexts.push(secondContext)
  const secondPage = await secondContext.newPage()
  monitor(secondPage, 'second-demo', browserEvidence)
  await startDemoFromLanding(secondPage)
  const secondSessionUserId = await secondPage.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' })
    const body = await response.json() as { user?: { id?: string } }
    return body.user?.id
  })
  assert(secondSessionUserId, 'Second browser session did not expose its authenticated user identity')
  const secondIdentity = (await pool.query<{ demo_instance_id: string; workspace_id: string }>(`SELECT u.demo_instance_id,w.id AS workspace_id FROM users u
    JOIN workspaces w ON w.demo_instance_id=u.demo_instance_id WHERE u.id=$1`, [secondSessionUserId])).rows[0]
  assert(secondIdentity, 'Second browser session did not map to an isolated demo workspace')
  const identities = await pool.query<{ demo_instance_id: string; workspace_id: string }>(`SELECT u.demo_instance_id,w.id AS workspace_id FROM users u
    JOIN workspaces w ON w.demo_instance_id=u.demo_instance_id WHERE u.name='Demo Visitor' ORDER BY u.created_at`)
  assert(identities.rows.length === 2 && identities.rows[0]!.workspace_id !== identities.rows[1]!.workspace_id, 'Two visitors did not receive isolated workspaces')
  blockedStatuses.otherDemo = await apiStatus(journeyPage, `/api/workspaces/${secondIdentity.workspace_id}/projects`)
  assert(blockedStatuses.otherDemo === 404, 'First visitor could read the second visitor workspace')

  await pool.query('UPDATE demo_instances SET expires_at=now() WHERE id=$1', [secondIdentity.demo_instance_id])
  assert(await apiStatus(secondPage, '/api/workspaces') === 401, 'Expired demo session still reached protected data')
  await secondPage.reload({ waitUntil: 'networkidle' })
  await secondPage.getByRole('heading', { name: 'Bring clarity to every project.' }).waitFor()
  assert((await pool.query('SELECT id FROM demo_instances WHERE id=$1', [secondIdentity.demo_instance_id])).rowCount === 0, 'Expired demo instance was not removed')
  await secondContext.close()
  contexts.splice(contexts.indexOf(secondContext), 1)

  await journeyPage.getByRole('button', { name: /Demo Visitor.*profile menu/i }).click()
  await journeyPage.getByRole('menuitem', { name: 'Sign out' }).click()
  await journeyPage.getByRole('heading', { name: 'Welcome back' }).waitFor()
  assert((await pool.query('SELECT id FROM demo_instances WHERE id=$1', [primaryIdentity.demo_instance_id])).rowCount === 0, 'Logout did not remove the primary demo instance')
  await journeyContext.close()
  contexts.splice(contexts.indexOf(journeyContext), 1)

  const rateStatuses: number[] = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, baseURL: enabled.origin })
    contexts.push(context)
    const page = await context.newPage()
    monitor(page, `rate-${attempt + 1}`, browserEvidence)
    await page.goto('/', { waitUntil: 'networkidle' })
    const status = await apiStatus(page, '/api/auth/demo', { method: 'POST', body: {} })
    rateStatuses.push(status)
    if (status === 201) assert(await apiStatus(page, '/api/auth/logout', { method: 'POST' }) === 204, 'Rate-limit setup demo did not clean up')
    await context.close()
    contexts.splice(contexts.indexOf(context), 1)
  }
  assert(rateStatuses.join(',') === '201,201,201,429', `Demo rate limit was not enforced on the sixth request: ${rateStatuses.join(',')}`)

  await Promise.all(browserEvidence.scans)
  const unexpectedNetwork = browserEvidence.networkErrors.filter((entry) => !expectedNetworkError(entry))
  assert(unexpectedNetwork.length === 0, `Unexpected browser API failures: ${unexpectedNetwork.map((entry) => `${entry.status} ${entry.path}`).join(', ')}`)
  assert(browserEvidence.consoleErrors.length === 0, `Browser console errors: ${browserEvidence.consoleErrors.join('; ')}`)
  assert(browserEvidence.pageErrors.length === 0, `Browser page errors: ${browserEvidence.pageErrors.join('; ')}`)
  assert(browserEvidence.sensitiveResponses.length === 0, `Sensitive fields appeared in API responses: ${browserEvidence.sensitiveResponses.join('; ')}`)
  assert((await pool.query("SELECT id FROM auth_tokens WHERE purpose IN ('password_reset','email_verification')")).rowCount === 0, 'Demo QA created an account recovery token')
  assert((await pool.query('SELECT id FROM demo_instances')).rowCount === 0, 'Final portfolio QA left demo instances behind')

  const screenshotNames = viewportMatrix.map((viewport) => `${viewport.label}.png`).concat([
    '07-demo-disabled.png',
    '08-portfolio-policy.png',
    '08-demo-dashboard.png',
    '09-projects.png',
    '10-task-comment-edited.png',
    '11-task-activity.png',
    '12-kanban-persisted.png',
    '13-authenticated-root.png',
  ])
  console.log(JSON.stringify({
    status: 'passed',
    performance: performanceMetrics,
    screenshots: screenshotNames,
    checks: [
      'six responsive landing breakpoints',
      'keyboard focus and compact navigation',
      'navigation anchors and sign-in return',
      'reduced motion and serious/critical accessibility',
      'disabled demo state',
      'portfolio registration and recovery policy',
      'landing-to-demo visitor journey',
      'task create/edit/assignment/status',
      'comment add/edit/delete and activity history',
      'Kanban refresh persistence',
      'dashboard metrics and authenticated root',
      'visitor/real-workspace isolation',
      'blocked privileged APIs',
      'expiry/logout cleanup',
      'six-attempt rate limit',
      'console/network/response hygiene',
    ],
    artifacts: artifactDirectory,
  }))
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)))
  if (browser) await browser.close().catch(() => undefined)
  if (enabledServer) await new Promise<void>((resolve) => enabledServer!.close(() => resolve()))
  if (disabledServer) await new Promise<void>((resolve) => disabledServer!.close(() => resolve()))
  if (portfolioServer) await new Promise<void>((resolve) => portfolioServer!.close(() => resolve()))
  const schema = qaDatabase?.schema
  if (qaDatabase) await qaDatabase.dispose()
  if (schema) {
    const verifier = new Pool({ connectionString: databaseUrl })
    try {
      const remaining = await verifier.query<{ exists: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS exists', [schema])
      assert(!remaining.rows[0]?.exists, 'Disposable final portfolio QA schema remained after cleanup')
    } finally { await verifier.end() }
  }
}
