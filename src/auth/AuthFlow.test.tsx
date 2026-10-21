import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { projectFixtures, taskFixtures, testMember } from '../test/projectFixtures'

const authenticatedUser = {
  id: '0ef8c070-8157-4c27-b58b-b80b143cff7c',
  name: 'Jordan Lee',
  email: 'jordan@example.com',
}
const workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Northstar Studio',
  role: 'owner',
  created_at: '2026-10-20T00:00:00.000Z',
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

function emptyResponse(status: number) {
  return Promise.resolve(new Response(null, { status }))
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

describe('frontend authentication integration', () => {
  it('redirects unauthenticated private routes to sign in', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('restores an authenticated session after refresh', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { user: authenticatedUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Jordan Lee profile menu' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('signs in with the backend and enters the protected dashboard', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(jsonResponse(200, { user: authenticatedUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
    render(<App />)

    await user.type(await screen.findByLabelText('Email address'), 'jordan@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    const [, request] = fetchMock.mock.calls[1]!
    expect(request).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
  })

  it('validates registration before creating an account', async () => {
    const user = userEvent.setup()
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    await user.click(await screen.findByRole('link', { name: 'Create an account' }))
    await user.type(screen.getByLabelText('Full name'), 'Jordan Lee')
    await user.type(screen.getByLabelText('Email address'), 'jordan@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'different')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows invalid credentials without carrying them into registration', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(jsonResponse(401, { error: 'Invalid email or password' }))
    render(<App />)

    await user.type(await screen.findByLabelText('Email address'), 'jordan@example.com')
    await user.type(screen.getByLabelText('Password'), 'incorrect password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Create an account' }))
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveValue('')
    expect(screen.queryByText('Email or password is incorrect.')).not.toBeInTheDocument()
  })

  it('logs out and clears the protected application state', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { user: authenticatedUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
      .mockReturnValueOnce(emptyResponse(204))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open Jordan Lee profile menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    expect(fetchMock.mock.calls[5]?.[0]).toBe('http://localhost:4000/api/auth/logout')
  })

  it('returns to sign in when a restored session expires', async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { user: authenticatedUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    window.dispatchEvent(new Event('focus'))

    expect(await screen.findByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })

  it('returns to sign in when a protected collaboration request reports an expired session', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { user: authenticatedUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    await user.click((await screen.findAllByText('Review homepage wireframes'))[0]!)
    await user.click(screen.getByRole('tab', { name: 'Comments' }))

    expect(await screen.findByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})
