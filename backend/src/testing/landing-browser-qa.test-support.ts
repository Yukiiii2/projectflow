import { access, mkdir } from 'node:fs/promises'
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
  assert(address && typeof address === 'object', 'Could not reserve a landing QA port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function monitor(page: Page, failures: string[]) {
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) failures.push(`console: ${message.text()}`) })
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (response.status() >= 400 && !(response.status() === 401 && path === '/api/auth/me')) failures.push(`HTTP ${response.status()} ${path}`)
  })
}

async function verifyLanding(page: Page, label: string, screenshotPath: string) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Bring clarity to every project.' }).waitFor()
  await page.getByRole('heading', { name: 'See ProjectFlow in action.' }).waitFor()
  await page.getByRole('heading', { name: 'Everything your team needs to move work forward.' }).waitFor()
  await page.getByRole('heading', { name: 'A clear path from idea to done.' }).waitFor()
  await page.getByRole('heading', { name: 'Your private workspace is ready when you are.' }).waitFor()
  const previewImages = page.locator('.landing-page img')
  for (let index = 0; index < await previewImages.count(); index += 1) {
    const image = previewImages.nth(index)
    await image.scrollIntoViewIfNeeded()
    await image.evaluate(async (element) => { await (element as HTMLImageElement).decode() })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  const previewsLoaded = await previewImages.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))
  assert(previewsLoaded, `${label} preview images did not load`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(overflow <= 1, `${label} landing layout overflowed by ${overflow}px`)
  const accessibility = await new AxeBuilder({ page }).analyze()
  const serious = accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
  assert(serious.length === 0, `${label} accessibility violations: ${serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(' ')} (${node.failureSummary ?? node.html})`).join(' | ')}`).join('; ')}`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
}

const localEnvPath = process.env.PROJECTFLOW_LOCAL_ENV_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url))
dotenv.config({ path: localEnvPath })
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'A local DATABASE_URL is required for landing browser QA')
const staticAssetsPath = fileURLToPath(new URL('../../../dist/', import.meta.url))
await access(fileURLToPath(new URL('../../../dist/index.html', import.meta.url)))
const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await access(edgePath)
const artifactDirectory = process.env.LANDING_QA_ARTIFACT_DIR ?? fileURLToPath(new URL('../../../.superpowers/sdd/2026-10-28-premium-landing-page/browser-qa/', import.meta.url))
await mkdir(artifactDirectory, { recursive: true })

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
      sessionSecret: 'landing-browser-qa-session-secret-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      demoModeEnabled: true,
    },
  })
  httpServer = app.listen(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { httpServer!.once('listening', resolve); httpServer!.once('error', reject) })

  browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const viewports = [
    { label: 'desktop', width: 1440, height: 1000 },
    { label: 'tablet', width: 1024, height: 768 },
    { label: 'compact-tablet', width: 800, height: 900 },
    { label: 'mobile', width: 390, height: 844 },
  ]
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, baseURL: origin, colorScheme: 'dark' })
    const page = await context.newPage()
    monitor(page, failures)
    await verifyLanding(page, viewport.label, `${artifactDirectory}/${viewport.label}.png`)
    if (viewport.width <= 900) {
      const trigger = page.getByRole('button', { name: 'Open navigation' })
      await trigger.click()
      const close = page.getByRole('button', { name: 'Close navigation' })
      await close.waitFor({ state: 'visible', timeout: 2_000 })
      assert(await close.evaluate((element) => element === document.activeElement), 'Mobile navigation did not move focus to its close control')
      await page.keyboard.press('Escape')
      await page.getByRole('navigation', { name: 'Mobile' }).waitFor({ state: 'detached' })
      assert(await trigger.evaluate((element) => element === document.activeElement), 'Mobile navigation did not restore trigger focus')
    }
    await context.close()
  }

  const reducedContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, baseURL: origin, reducedMotion: 'reduce' })
  const reducedPage = await reducedContext.newPage()
  monitor(reducedPage, failures)
  await reducedPage.goto('/', { waitUntil: 'networkidle' })
  const motion = await reducedPage.locator('.landing-hero__copy').evaluate((element) => ({
    animationDuration: Number.parseFloat(getComputedStyle(element).animationDuration),
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
  }))
  assert(motion.animationDuration <= 0.001, `Reduced-motion animation remained ${motion.animationDuration}s`)
  assert(motion.scrollBehavior === 'auto', `Reduced-motion scroll behavior remained ${motion.scrollBehavior}`)
  await reducedContext.close()

  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin, colorScheme: 'dark' })
  const demoPage = await demoContext.newPage()
  monitor(demoPage, failures)
  await demoPage.goto('/', { waitUntil: 'networkidle' })
  await demoPage.getByRole('button', { name: 'Try Live Demo' }).first().click()
  await demoPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await demoPage.getByText('Private demo workspace', { exact: true }).waitFor()
  const logoutStatus = await demoPage.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })).status)
  assert(logoutStatus === 204, `Landing demo logout returned HTTP ${logoutStatus}`)
  await demoContext.close()
  assert((await pool.query('SELECT id FROM demo_instances')).rowCount === 0, 'Landing QA left demo records behind')
  assert(failures.length === 0, `Landing browser failures: ${failures.join('; ')}`)

  console.log(JSON.stringify({ status: 'passed', checks: ['desktop visual and accessibility', 'tablet visual and accessibility', 'compact-tablet navigation and accessibility', 'mobile visual, accessibility, and keyboard navigation', 'reduced motion', 'real demo entry', 'responsive overflow', 'preview loading', 'demo cleanup'], artifacts: artifactDirectory }))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  const schema = qaDatabase?.schema
  if (qaDatabase) await qaDatabase.dispose()
  if (schema) {
    const verifier = new Pool({ connectionString: databaseUrl })
    try {
      const remaining = await verifier.query<{ exists: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS exists', [schema])
      assert(!remaining.rows[0]?.exists, 'Disposable landing QA schema remained after cleanup')
    } finally { await verifier.end() }
  }
}
