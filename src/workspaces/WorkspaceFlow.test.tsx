import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { projectApiFixture } from '../test/projectFixtures'

const user = {
  id: '0ef8c070-8157-4c27-b58b-b80b143cff7c',
  name: 'Jordan Lee',
  email: 'jordan@example.com',
}

const northstar = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Northstar Studio',
  role: 'owner',
  created_at: '2026-10-20T00:00:00.000Z',
}

const harbor = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Harbor Labs',
  role: 'member',
  created_at: '2026-10-19T00:00:00.000Z',
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('workspace integration', () => {
  it('loads only the authenticated memberships and switches the dashboard workspace', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me')) return json(200, { user })
      if (url.endsWith('/api/workspaces')) return json(200, { workspaces: [northstar, harbor] })
      const fixture = projectApiFixture(url)
      if (fixture) return json(200, fixture)
      return json(404, { error: 'Route not found' })
    })

    const visitor = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    const selector = screen.getByLabelText('Workspace')
    expect(selector).toHaveValue(northstar.id)
    expect(screen.getByRole('option', { name: 'Northstar Studio' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Harbor Labs' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Unrelated Workspace' })).not.toBeInTheDocument()

    await visitor.selectOptions(selector, harbor.id)
    expect(screen.getByText('Harbor Labs', { selector: '.topbar__workspace-copy > span' })).toBeInTheDocument()
    expect(await screen.findByTestId('active-projects-value')).toHaveTextContent('3')
    expect(screen.getByTestId('workspace-role')).toHaveTextContent('Member')
    expect(window.localStorage.getItem(`projectflow-workspace:${user.id}`)).toBe(harbor.id)
  })

  it('ignores a stale stored workspace id that is absent from the membership response', async () => {
    window.localStorage.setItem(`projectflow-workspace:${user.id}`, '33333333-3333-4333-8333-333333333333')
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me')) return json(200, { user })
      if (url.endsWith('/api/workspaces')) return json(200, { workspaces: [northstar] })
      const fixture = projectApiFixture(url)
      if (fixture) return json(200, fixture)
      return json(404, { error: 'Route not found' })
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace')).toHaveValue(northstar.id)
    expect(window.localStorage.getItem(`projectflow-workspace:${user.id}`)).toBe(northstar.id)
  })

  it('creates the first PostgreSQL-backed workspace from the empty state', async () => {
    const created = { ...northstar, name: 'Lumen Workshop' }
    fetchMock.mockImplementation((input, init) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me')) return json(200, { user })
      if (url.endsWith('/api/workspaces') && init?.method === 'POST') return json(201, { workspace: created })
      if (url.endsWith('/api/workspaces')) return json(200, { workspaces: [] })
      const fixture = projectApiFixture(url)
      if (fixture) return json(200, fixture)
      return json(404, { error: 'Route not found' })
    })

    const visitor = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Create your first workspace' })).toBeInTheDocument()
    await visitor.type(screen.getByLabelText('Workspace name'), 'Lumen Workshop')
    await visitor.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace')).toHaveValue(created.id)
    const post = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/api/workspaces') && init?.method === 'POST')
    expect(post?.[1]).toEqual(expect.objectContaining({ credentials: 'include', body: JSON.stringify({ name: 'Lumen Workshop' }) }))
  })

  it('shows a retryable load failure and recovers without losing the auth session', async () => {
    let workspaceRequests = 0
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me')) return json(200, { user })
      if (url.endsWith('/api/workspaces')) {
        workspaceRequests += 1
        return workspaceRequests === 1
          ? json(500, { error: 'Internal server error' })
          : json(200, { workspaces: [northstar] })
      }
      const fixture = projectApiFixture(url)
      if (fixture) return json(200, fixture)
      return json(404, { error: 'Route not found' })
    })

    const visitor = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'We could not load your workspaces' })).toBeInTheDocument()
    await visitor.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(workspaceRequests).toBe(2)
  })

  it('returns to sign in when workspace access reports an expired session', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me')) return json(200, { user })
      if (url.endsWith('/api/workspaces')) return json(401, { error: 'Sign in required' })
      return json(404, { error: 'Route not found' })
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})
