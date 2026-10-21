import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'

const baseUrl = process.env.PROJECTFLOW_URL ?? 'http://127.0.0.1:4173/'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = path.resolve('artifacts/screenshots')
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath: edgePath, headless: true })
const results = []

async function inspect(page, name, viewport) {
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const layout = await page.evaluate(() => {
    const root = document.documentElement
    const candidates = [...document.querySelectorAll('button, select, h1, h2, p, strong, time, [data-testid]')]
    const outOfBounds = candidates
      .filter((element) => {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1)
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: element.getBoundingClientRect().toJSON(),
      }))

    const clippedText = candidates
      .filter((element) => {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (element.hasAttribute('data-tooltip')) return false
        if (style.textOverflow === 'ellipsis') return false
        return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
      }))

    return {
      viewport: [window.innerWidth, window.innerHeight],
      documentWidth: root.scrollWidth,
      horizontalOverflow: Math.max(0, root.scrollWidth - window.innerWidth),
      outOfBounds,
      clippedText,
    }
  })

  const screenshot = path.join(outputDir, `${name}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  const violations = accessibility.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    nodes: violation.nodes.length,
    samples: violation.nodes.slice(0, 12).map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }))
  const record = { name, viewport, screenshot, violations, ...layout }
  results.push(record)

  if (layout.horizontalOverflow > 1 || layout.outOfBounds.length > 0 || layout.clippedText.length > 0 || violations.length > 0) {
    throw new Error(`Quality issue in ${name}: ${JSON.stringify({ layout, violations })}`)
  }
}

async function openPage(viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'no-preference' })
  const page = await context.newPage()
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'visual-qa', name: 'Maya Chen', email: 'maya@northstar.studio' } }),
  }))
  await page.route('**/api/workspaces', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      workspaces: [
        { id: 'northstar', name: 'Northstar Studio', role: 'owner', created_at: '2026-10-20T00:00:00.000Z' },
        { id: 'harbor', name: 'Harbor Labs', role: 'member', created_at: '2026-10-19T00:00:00.000Z' },
      ],
    }),
  }))
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  return { context, page, errors }
}

try {
  {
    const viewport = { width: 1440, height: 1000 }
    const { context, page, errors } = await openPage(viewport)
    await inspect(page, 'dashboard-desktop-dark', viewport)

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    if ((await page.locator('html').getAttribute('data-theme')) !== 'light') throw new Error('Theme did not switch to light')
    await page.waitForTimeout(250)
    await inspect(page, 'dashboard-desktop-light', viewport)

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    if ((await page.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')) !== 'false') throw new Error('Sidebar did not collapse')
    await inspect(page, 'dashboard-desktop-collapsed', viewport)

    await page.locator('#workspace-select').selectOption('harbor')
    if ((await page.getByTestId('tasks-completed-value').textContent())?.trim() !== '54 / 72') throw new Error('Workspace metrics did not update')
    await page.getByLabel('Reporting period').selectOption('7d')
    if (!(await page.getByTestId('completion-caption').textContent())?.includes('Last 7 days')) throw new Error('Period caption did not update')

    await page.getByRole('button', { name: 'Empty' }).click()
    await page.waitForTimeout(350)
    await inspect(page, 'dashboard-empty', viewport)
    await page.getByRole('button', { name: 'Loading' }).click()
    await inspect(page, 'dashboard-loading', viewport)
    await page.getByRole('button', { name: 'Error' }).click()
    await inspect(page, 'dashboard-error', viewport)

    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }

  for (const definition of [
    { name: 'dashboard-tablet', viewport: { width: 768, height: 1024 } },
    { name: 'dashboard-intermediate', viewport: { width: 700, height: 900 } },
    { name: 'dashboard-mobile', viewport: { width: 390, height: 844 } },
    { name: 'dashboard-narrow', viewport: { width: 320, height: 720 } },
  ]) {
    const { context, page, errors } = await openPage(definition.viewport)
    await inspect(page, definition.name, definition.viewport)

    if (definition.viewport.width <= 390) {
      await page.getByRole('button', { name: 'Open navigation drawer' }).click()
      await page.getByRole('complementary', { name: 'Mobile navigation' }).waitFor({ state: 'visible' })
      await page.waitForTimeout(550)
      await inspect(page, `${definition.name}-drawer`, definition.viewport)
      await page.getByRole('button', { name: 'Close navigation drawer' }).click()
    }

    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(
    path.resolve('artifacts/visual-qa-report.json'),
    `${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8',
  )
}

console.log(`Visual QA passed for ${results.length} captured states.`)
