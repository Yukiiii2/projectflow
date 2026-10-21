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
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = path.resolve('artifacts/screenshots')
const email = `stage-a-${randomUUID()}@example.invalid`
const password = `${randomBytes(24).toString('base64url')}Aa1!`
const name = 'Stage A Reviewer'
const workspaceName = 'Stage A Workspace'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
let createdUserId

await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const layout = await page.evaluate(() => {
    const root = document.documentElement
    const candidates = [...document.querySelectorAll('button, a, label, h1, h2, p, strong, [role="alert"]')]
    const visible = candidates.filter((element) => {
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0
    })
    return {
      documentWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - window.innerWidth),
      outOfBounds: visible.filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left < -1 || rect.right > window.innerWidth + 1
      }).map((element) => element.textContent?.trim().slice(0, 60)).slice(0, 10),
      clippedText: visible.filter((element) => {
        const style = getComputedStyle(element)
        if (style.textOverflow === 'ellipsis') return false
        if (style.overflow === 'visible' && style.overflowX === 'visible' && style.overflowY === 'visible') return false
        return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
      }).map((element) => element.textContent?.trim().slice(0, 60)).slice(0, 10),
    }
  })
  const violations = accessibility.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  }))
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true })
  results.push({ name, viewport, ...layout, violations })
  if (layout.horizontalOverflow || layout.outOfBounds.length || layout.clippedText.length || violations.length) {
    throw new Error(`Quality issue in ${name}: ${JSON.stringify({ layout, violations })}`)
  }
}

async function cleanup() {
  const found = await pool.query('SELECT id FROM users WHERE email=$1', [email])
  const userId = createdUserId ?? found.rows[0]?.id
  if (userId) {
    await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [userId])
    await pool.query('DELETE FROM workspaces WHERE created_by=$1', [userId])
    await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [userId, email])
  }
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true })

try {
  const desktopViewport = { width: 1440, height: 1000 }
  const desktop = await browser.newContext({ viewport: desktopViewport, colorScheme: 'dark' })
  const page = await desktop.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 500) browserErrors.push(`HTTP ${response.status()} from ${new URL(response.url()).pathname}`)
  })

  await page.goto(`${frontendUrl}/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
  if (new URL(page.url()).pathname !== '/login') throw new Error('Private route did not redirect to sign in')
  await inspect(page, 'auth-login-desktop-dark', desktopViewport)

  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await inspect(page, 'auth-login-desktop-light', desktopViewport)
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()

  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Email or password is incorrect.').waitFor()

  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByRole('heading', { name: 'Create your account' }).waitFor()
  await inspect(page, 'auth-register-desktop-dark', desktopViewport)
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await page.getByLabel('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()

  const user = await pool.query('SELECT id,password_hash FROM users WHERE email=$1', [email])
  if (!user.rows[0]?.password_hash?.startsWith('$argon2id$')) throw new Error('Browser registration did not store an Argon2id hash')
  createdUserId = user.rows[0].id

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await page.getByRole('button', { name: `Open ${name} profile menu` }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()

  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(`${randomBytes(20).toString('base64url')}Bb2!`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Email or password is incorrect.').waitFor()
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await page.getByRole('button', { name: `Open ${name} profile menu` }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()

  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join('; ')}`)
  await desktop.close()

  for (const definition of [
    { name: 'auth-login-mobile', path: '/login', viewport: { width: 390, height: 844 } },
    { name: 'auth-register-narrow', path: '/register', viewport: { width: 320, height: 720 } },
  ]) {
    const context = await browser.newContext({ viewport: definition.viewport, colorScheme: 'dark' })
    const mobilePage = await context.newPage()
    await mobilePage.goto(`${frontendUrl}${definition.path}`, { waitUntil: 'networkidle' })
    await mobilePage.getByRole('heading', { name: definition.path === '/login' ? 'Welcome back' : 'Create your account' }).waitFor()
    await inspect(mobilePage, definition.name, definition.viewport)
    await context.close()
  }

  console.log('Authentication browser QA passed: responsive screens, accessibility, registration, restoration, login, and logout.')
} finally {
  await browser.close()
  await cleanup()
  await pool.end()
  await writeFile(path.resolve('artifacts/auth-qa-report.json'), `${JSON.stringify({ frontendUrl, generatedAt: new Date().toISOString(), results }, null, 2)}\n`)
}
