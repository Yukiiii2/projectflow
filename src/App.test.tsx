import { render, screen, waitForElementToBeRemoved, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { projectApiFixture } from './test/projectFixtures'

const fetchMock = vi.fn<typeof fetch>()
const user = { id: 'maya', name: 'Maya Chen', email: 'maya@northstar.studio' }
const workspaces = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Northstar Studio', role: 'owner', created_at: '2026-10-20T00:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Harbor Labs', role: 'member', created_at: '2026-10-19T00:00:00.000Z' },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
  window.history.replaceState({}, '', '/')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation((input, init) => {
    const url = String(input)
    const fixture = projectApiFixture(url, init?.method ?? 'GET')
    const body = url.endsWith('/api/workspaces') ? { workspaces } : url.endsWith('/api/auth/me') ? { user } : fixture
    return Promise.resolve(new Response(JSON.stringify(body ?? { error: 'Route not found' }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } }))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('ProjectFlow Stage 1 prototype', () => {
  it('renders the approved Northstar dashboard with consistent metrics', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace')).toHaveValue(workspaces[0].id)
    expect(await screen.findByTestId('active-projects-value')).toHaveTextContent('4')
    expect(screen.getByTestId('tasks-completed-value')).toHaveTextContent('96 / 128')
    expect(screen.getByTestId('due-this-week-value')).toHaveTextContent('8')
    expect(screen.getByTestId('overdue-tasks-value')).toHaveTextContent('3')
  })

  it('switches workspaces and reporting periods with coherent mock data', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Dashboard' })
    await user.selectOptions(screen.getByLabelText('Workspace'), workspaces[1].id)
    expect(await screen.findByTestId('active-projects-value')).toHaveTextContent('3')
    expect(await screen.findByTestId('tasks-completed-value')).toHaveTextContent('54 / 72')

    await user.selectOptions(screen.getByLabelText('Reporting period'), '7d')
    expect(screen.getByTestId('completion-caption')).toHaveTextContent('Last 7 days')
  })

  it('supports theme, sidebar, task, and preview-state interactions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Dashboard' })
    const themeButton = screen.getByRole('button', { name: 'Switch to light theme' })
    await user.click(themeButton)
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')

    const sidebarButton = screen.getByRole('button', { name: 'Collapse sidebar' })
    await user.click(sidebarButton)
    expect(sidebarButton).toHaveAttribute('aria-expanded', 'false')

    const task = await screen.findByRole('checkbox', { name: 'Mark Review homepage wireframes complete' })
    await user.click(task)
    expect(screen.getByTestId('tasks-completed-value')).toHaveTextContent('97 / 128')
    expect(screen.getByTestId('due-this-week-value')).toHaveTextContent('7')

    const preview = screen.getByRole('group', { name: 'Dashboard preview state' })
    await user.click(within(preview).getByRole('button', { name: 'Empty' }))
    expect(screen.getByRole('heading', { name: 'Your workspace is ready for its first project' })).toBeInTheDocument()

    await user.click(within(preview).getByRole('button', { name: 'Error' }))
    expect(screen.getByRole('heading', { name: 'We could not load your dashboard' })).toBeInTheDocument()
  })

  it('opens the profile menu and explains deferred interactions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: 'Dashboard' })
    await user.click(screen.getByRole('button', { name: 'Open Maya Chen profile menu' }))
    expect(screen.getByRole('menu', { name: 'Profile menu' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Profile settings' }))
    expect(screen.getByRole('status')).toHaveTextContent('Profile settings are planned for a later stage.')
  })

  it('moves focus into the mobile drawer and restores it after Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Dashboard' })
    const trigger = screen.getByRole('button', { name: 'Open navigation drawer' })

    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Close navigation drawer' })).toHaveFocus()
    await user.keyboard('{Escape}')

    await waitForElementToBeRemoved(() => screen.queryByLabelText('Mobile navigation'))
    expect(trigger).toHaveFocus()
  })
})
