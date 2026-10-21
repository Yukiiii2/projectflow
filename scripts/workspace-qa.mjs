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
  { name: 'Workspace Owner', email: `stage-b-owner-${runId}@example.invalid` },
  { name: 'Workspace Member', email: `stage-b-member-${runId}@example.invalid` },
]
const names = {
  alpha: `Northstar QA ${runId.slice(0, 6)}`,
  second: `Harbor QA ${runId.slice(0, 6)}`,
  isolated: `Isolated QA ${runId.slice(0, 6)}`,
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const results = []
const createdUserIds = []

await mkdir(outputDir, { recursive: true })

async function inspect(page, name, viewport) {
  await page.waitForTimeout(550)
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const layout = await page.evaluate(() => {
    const root = document.documentElement
    const candidates = [...document.querySelectorAll('button, a, label, h1, h2, p, strong, select, input, [role="alert"]')]
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0
      })
    return {
      documentWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - window.innerWidth),
      outOfBounds: candidates.filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left < -1 || rect.right > window.innerWidth + 1
      }).map((element) => element.textContent?.trim().slice(0, 60)).slice(0, 10),
      clippedText: candidates.filter((element) => {
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
    samples: violation.nodes.slice(0, 8).map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }))
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true })
  results.push({ name, viewport, ...layout, violations })
  if (layout.horizontalOverflow || layout.outOfBounds.length || layout.clippedText.length || violations.length) {
    throw new Error(`Quality issue in ${name}: ${JSON.stringify({ layout, violations })}`)
  }
}

async function register(page, account) {
  await page.goto(`${frontendUrl}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Full name').fill(account.name)
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  const query = await pool.query('SELECT id FROM users WHERE email=$1', [account.email])
  const userId = query.rows[0]?.id
  if (!userId) throw new Error('Registered test account was not stored')
  createdUserIds.push(userId)
  return userId
}

async function createWorkspace(page, name) {
  await page.getByLabel('Workspace name').fill(name)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const query = await pool.query('SELECT id FROM workspaces WHERE name=$1 AND created_by=ANY($2::uuid[])', [name, createdUserIds])
  const workspaceId = query.rows[0]?.id
  if (!workspaceId) throw new Error(`Created workspace was not stored: ${name}`)
  return workspaceId
}

async function browserApi(page, pathname, init = {}) {
  return page.evaluate(async ({ url, request }) => {
    const response = await fetch(url, { ...request, credentials: 'include' })
    const body = response.status === 204 ? null : await response.json()
    return { status: response.status, body }
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
  const ownerErrors = []
  ownerPage.on('pageerror', (error) => ownerErrors.push(error.message))
  ownerPage.on('response', (response) => {
    if (response.status() >= 500) ownerErrors.push(`HTTP ${response.status()} from ${new URL(response.url()).pathname}`)
  })

  const ownerId = await register(ownerPage, accounts[0])
  await inspect(ownerPage, 'workspace-empty-desktop', desktopViewport)
  const alphaId = await createWorkspace(ownerPage, names.alpha)
  if (await ownerPage.locator('#workspace-select').inputValue() !== alphaId) throw new Error('Created workspace was not selected')
  if ((await ownerPage.getByTestId('workspace-role').textContent())?.trim() !== 'Owner') throw new Error('Owner role was not rendered')
  await inspect(ownerPage, 'workspace-dashboard-desktop', desktopViewport)

  await ownerPage.getByRole('button', { name: 'Create workspace' }).click()
  await ownerPage.getByRole('heading', { name: 'Create a workspace' }).waitFor()
  await inspect(ownerPage, 'workspace-create-desktop', desktopViewport)
  const secondId = await createWorkspace(ownerPage, names.second)
  const ownerOptions = await ownerPage.locator('#workspace-select option').allTextContents()
  if (!ownerOptions.includes(names.alpha) || !ownerOptions.includes(names.second) || ownerOptions.length !== 2) {
    throw new Error('Owner workspace selector did not match API memberships')
  }
  await ownerPage.locator('#workspace-select').selectOption(alphaId)
  await ownerPage.reload({ waitUntil: 'networkidle' })
  await ownerPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  if (await ownerPage.locator('#workspace-select').inputValue() !== alphaId) throw new Error('Workspace selection did not persist after reload')

  const memberContext = await browser.newContext({ viewport: desktopViewport, colorScheme: 'dark' })
  const memberPage = await memberContext.newPage()
  const memberId = await register(memberPage, accounts[1])
  const isolatedId = await createWorkspace(memberPage, names.isolated)

  const beforeMembership = await browserApi(memberPage, '/api/workspaces')
  if (beforeMembership.status !== 200 || beforeMembership.body.workspaces.length !== 1 || beforeMembership.body.workspaces[0].id !== isolatedId) {
    throw new Error('Workspace list exposed another user before membership was granted')
  }
  const ownerList = await browserApi(ownerPage, '/api/workspaces')
  if (ownerList.body.workspaces.some((workspace) => workspace.id === isolatedId)) throw new Error('Owner list exposed the isolated workspace')

  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)', [alphaId, memberId, 'member'])
  await memberPage.reload({ waitUntil: 'networkidle' })
  await memberPage.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await memberPage.locator('#workspace-select option').filter({ hasText: names.alpha }).waitFor({ state: 'attached' })
  const memberOptions = await memberPage.locator('#workspace-select option').allTextContents()
  if (!memberOptions.includes(names.alpha) || !memberOptions.includes(names.isolated) || memberOptions.includes(names.second)) {
    throw new Error('Member selector did not respect workspace memberships')
  }
  await memberPage.locator('#workspace-select').selectOption(alphaId)
  if ((await memberPage.getByTestId('workspace-role').textContent())?.trim() !== 'Member') throw new Error('Member role was not rendered')

  const forbiddenCreate = await browserApi(memberPage, `/api/workspaces/${alphaId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Forbidden project' }),
  })
  if (forbiddenCreate.status !== 403) throw new Error('Member project-creation boundary was not enforced')
  const hiddenWorkspace = await browserApi(memberPage, `/api/workspaces/${secondId}/projects`)
  if (hiddenWorkspace.status !== 404) throw new Error('Non-member workspace access was not hidden')

  await memberPage.setViewportSize({ width: 390, height: 844 })
  await memberPage.goto(`${frontendUrl}/workspaces/new`, { waitUntil: 'networkidle' })
  await memberPage.getByRole('heading', { name: 'Create a workspace' }).waitFor()
  await inspect(memberPage, 'workspace-create-mobile', { width: 390, height: 844 })
  await memberPage.setViewportSize({ width: 320, height: 720 })
  await inspect(memberPage, 'workspace-create-narrow', { width: 320, height: 720 })

  const anonymousContext = await browser.newContext({ viewport: desktopViewport })
  const anonymousPage = await anonymousContext.newPage()
  await anonymousPage.goto(`${frontendUrl}/login`, { waitUntil: 'networkidle' })
  const anonymousList = await browserApi(anonymousPage, '/api/workspaces')
  if (anonymousList.status !== 401) throw new Error('Anonymous workspace access was not rejected')
  await anonymousContext.close()

  if (ownerErrors.length) throw new Error(`Browser errors: ${ownerErrors.join('; ')}`)
  if (ownerId === memberId) throw new Error('Test identities were not isolated')
  await ownerContext.close()
  await memberContext.close()
  console.log('Workspace browser QA passed: creation, loading, switching, persistence, roles, isolation, and responsive layouts.')
} finally {
  await browser.close()
  await cleanup()
  const remaining = await pool.query('SELECT count(*)::int AS count FROM users WHERE email=ANY($1::text[])', [accounts.map((account) => account.email)])
  await pool.end()
  await writeFile(path.resolve('artifacts/workspace-qa-report.json'), `${JSON.stringify({
    frontendUrl,
    generatedAt: new Date().toISOString(),
    results,
    temporaryAccountsRemaining: remaining.rows[0]?.count ?? 0,
  }, null, 2)}\n`)
}
