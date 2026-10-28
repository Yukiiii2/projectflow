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
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('frontend authentication integration', () => {
  it('renders the public landing page at the root for an unauthenticated visitor', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Bring clarity to every project.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('waits for session restoration before choosing the public or authenticated root', async () => {
    let resolveSession!: (response: Response) => void
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSession = resolve }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
    render(<App />)

    expect(await screen.findByText('Restoring your session…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Bring clarity to every project.' })).not.toBeInTheDocument()

    resolveSession(new Response(JSON.stringify({ user: authenticatedUser }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('enters an isolated temporary demo and hides privileged controls', async () => {
    const user = userEvent.setup()
    const demoUser = { ...authenticatedUser, name: 'Demo Visitor', email: 'visitor@demo.projectflow.invalid', demo: true, demo_expires_at: '2026-10-28T05:30:00.000Z' }
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(jsonResponse(201, { user: demoUser }))
      .mockReturnValueOnce(jsonResponse(200, { workspaces: [workspace] }))
      .mockReturnValueOnce(jsonResponse(200, { projects: projectFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { tasks: taskFixtures(workspace.id) }))
      .mockReturnValueOnce(jsonResponse(200, { members: [testMember] }))
    render(<App />)

    await user.click((await screen.findAllByRole('button', { name: 'Try Live Demo' }))[0]!)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/private demo workspace/i)).toBeInTheDocument()
    expect(screen.getByText(/cleared after 30 minutes/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Demo Visitor.*profile menu/i }))
    expect(screen.getByText('Temporary demo')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Profile settings' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getAllByRole('button', { name: 'Team' })[0]!)
    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Invite member/i })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:4000/api/auth/demo')
  })

  it('requests password recovery without revealing account existence', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/login')
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(jsonResponse(202, { message: 'If an account matches that email, a reset link has been sent.' }))
    render(<App />)

    await user.click(await screen.findByRole('link', { name: 'Forgot password?' }))
    await user.type(screen.getByLabelText('Email address'), 'jordan@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('If an account matches that email, a reset link has been sent.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:4000/api/auth/password-reset/request')
  })

  it('validates and completes a password reset link', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/reset-password?token=valid-reset-token-with-more-than-32-characters')
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(emptyResponse(204))
    render(<App />)

    await user.type(await screen.findByLabelText('New password'), 'a new correct horse battery staple')
    await user.type(screen.getByLabelText('Confirm new password'), 'a new correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Your password has been reset. Sign in with your new password.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('gates the application for an explicitly unverified account and resends verification', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation((input) => String(input).endsWith('/api/auth/me')
      ? jsonResponse(200, { user: { ...authenticatedUser, email_verified: false, email_verification_required: true } })
      : jsonResponse(202, { message: 'Verification email requested.' }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }))
    expect(await screen.findByText('Verification email requested.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/auth/email-verification/request'))).toBe(true)
  })

  it('redirects unauthenticated private routes to sign in', async () => {
    window.history.replaceState({}, '', '/projects')
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
    expect(screen.getByRole('button', { name: /Jordan Lee.*profile menu/i })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('signs in with the backend and enters the protected dashboard', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/login')
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
    window.history.replaceState({}, '', '/register')
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    await user.type(await screen.findByLabelText('Full name'), 'Jordan Lee')
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
    window.history.replaceState({}, '', '/login')
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

    await user.click(await screen.findByRole('button', { name: /Jordan Lee.*profile menu/i }))
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
