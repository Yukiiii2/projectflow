import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import session from 'express-session'
import { chromium, type Browser } from 'playwright-core'
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
  assert(address && typeof address === 'object', 'Could not reserve a landing preview port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

const localEnvPath = process.env.PROJECTFLOW_LOCAL_ENV_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url))
dotenv.config({ path: localEnvPath })
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'A local DATABASE_URL is required to capture landing previews')
const staticAssetsPath = fileURLToPath(new URL('../../../dist/', import.meta.url))
await access(fileURLToPath(new URL('../../../dist/index.html', import.meta.url)))
const edgePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await access(edgePath)

const previewPaths = {
  dashboardDesktop: fileURLToPath(new URL('../../../public/projectflow-dashboard-1280.jpg', import.meta.url)),
  dashboardTablet: fileURLToPath(new URL('../../../public/projectflow-dashboard-800.jpg', import.meta.url)),
  kanbanDesktop: fileURLToPath(new URL('../../../public/projectflow-kanban-1280.jpg', import.meta.url)),
  kanbanTablet: fileURLToPath(new URL('../../../public/projectflow-kanban-800.jpg', import.meta.url)),
}

let qaDatabase: IsolatedEmailQaDatabase | undefined
let browser: Browser | undefined
let httpServer: ReturnType<ReturnType<typeof createApp>['listen']> | undefined

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
      sessionSecret: 'landing-preview-session-secret-at-least-32-characters',
      production: false,
      requireEmailVerification: true,
      demoModeEnabled: true,
    },
  })
  httpServer = app.listen(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { httpServer!.once('listening', resolve); httpServer!.once('error', reject) })

  browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: origin, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Try Demo' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await page.locator('.dashboard-overview').waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dashboard-overview')!).opacity === '1')

  await page.screenshot({ path: previewPaths.dashboardDesktop, type: 'jpeg', quality: 84 })
  await page.setViewportSize({ width: 800, height: 500 })
  await page.screenshot({ path: previewPaths.dashboardTablet, type: 'jpeg', quality: 84 })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/board', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Kanban board' }).waitFor()
  await page.screenshot({ path: previewPaths.kanbanDesktop, type: 'jpeg', quality: 84 })
  await page.setViewportSize({ width: 800, height: 500 })
  await page.screenshot({ path: previewPaths.kanbanTablet, type: 'jpeg', quality: 84 })

  const logoutStatus = await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })).status)
  assert(logoutStatus === 204, `Landing preview logout returned HTTP ${logoutStatus}`)
  assert((await pool.query('SELECT id FROM demo_instances')).rowCount === 0, 'Landing preview capture left demo records behind')
  await context.close()

  const sizes: Record<string, number> = Object.fromEntries(await Promise.all(Object.entries(previewPaths).map(async ([name, path]) => [name, (await stat(path)).size] as const)))
  for (const [name, size] of Object.entries(sizes)) assert(size > 20_000, `${name} is unexpectedly small`)
  console.log(JSON.stringify({ status: 'passed', previews: sizes }))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  const schema = qaDatabase?.schema
  if (qaDatabase) await qaDatabase.dispose()
  if (schema) {
    const verifier = new Pool({ connectionString: databaseUrl })
    try {
      const remaining = await verifier.query<{ exists: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS exists', [schema])
      assert(!remaining.rows[0]?.exists, 'Disposable landing preview schema remained after cleanup')
    } finally { await verifier.end() }
  }
}
