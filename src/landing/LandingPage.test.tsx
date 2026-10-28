import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { projectFixtures, taskFixtures, testMember } from '../test/projectFixtures'

const fetchMock = vi.fn<typeof fetch>()
const workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Northstar Studio',
  role: 'owner',
  created_at: '2026-10-20T00:00:00.000Z',
}
const demoUser = {
  id: '0ef8c070-8157-4c27-b58b-b80b143cff7c',
  name: 'Demo Visitor',
  email: 'visitor@demo.projectflow.invalid',
  demo: true,
  demo_expires_at: '2026-10-28T05:30:00.000Z',
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

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

describe('public ProjectFlow landing page', () => {
  it('presents accurate product sections and functional navigation', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Bring clarity to every project.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'See ProjectFlow in action.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Everything your team needs to move work forward.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A clear path from idea to done.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your private workspace is ready when you are.' })).toBeInTheDocument()

    for (const feature of [
      'Workspace organization',
      'Projects and tasks',
      'Kanban workflow',
      'Assignments and due dates',
      'Team collaboration',
      'Progress insights',
    ]) expect(screen.getByRole('heading', { name: feature })).toBeInTheDocument()

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).getByRole('link', { name: 'Product' })).toHaveAttribute('href', '#product')
    expect(within(primary).getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(within(primary).getByRole('link', { name: 'How It Works' })).toHaveAttribute('href', '#how-it-works')
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Explore Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'View source on GitHub' })).toHaveAttribute('href', 'https://github.com/Yukiiii2/projectflow')
  })

  it('uses the existing secure demo action to enter the real application', async () => {
    const user = userEvent.setup()
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:4000/api/auth/demo')
  })

  it('shares one pending demo state and prevents duplicate requests', async () => {
    const user = userEvent.setup()
    let resolveDemo!: (response: Response) => void
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDemo = resolve }))
    render(<App />)

    const demoButtons = await screen.findAllByRole('button', { name: 'Try Live Demo' })
    await user.click(demoButtons[0]!)
    expect(await screen.findAllByRole('button', { name: 'Preparing your demo…' })).toHaveLength(demoButtons.length)
    for (const button of screen.getAllByRole('button', { name: 'Preparing your demo…' })) expect(button).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveDemo(new Response(JSON.stringify({ error: 'All demo workspaces are currently in use.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(await screen.findByRole('alert')).toHaveTextContent('All demo workspaces are currently in use. Try again in a few minutes.')
  })

  it('shows an explicit unavailable state when demo mode is disabled', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
      .mockReturnValueOnce(jsonResponse(404, { error: 'Route not found' }))
    render(<App />)

    await user.click((await screen.findAllByRole('button', { name: 'Try Live Demo' }))[0]!)

    expect(await screen.findByRole('alert')).toHaveTextContent('The live demo is temporarily unavailable.')
  })

  it('opens and closes keyboard-accessible mobile navigation', async () => {
    const user = userEvent.setup()
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    const trigger = await screen.findByRole('button', { name: 'Open navigation' })
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
    await user.click(trigger)
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('reserves preview space and prioritizes only the hero product image', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(401, { error: 'Sign in required' }))
    render(<App />)

    const hero = await screen.findByAltText('ProjectFlow dashboard showing project health, task progress, and recent work')
    expect(hero).toHaveAttribute('width', '1280')
    expect(hero).toHaveAttribute('height', '800')
    expect(hero).toHaveAttribute('fetchpriority', 'high')
    expect(hero).toHaveAttribute('decoding', 'async')

    const kanban = screen.getByAltText('ProjectFlow Kanban board with tasks organized across workflow columns')
    expect(kanban).toHaveAttribute('width', '1280')
    expect(kanban).toHaveAttribute('height', '800')
    expect(kanban).toHaveAttribute('loading', 'lazy')
    expect(kanban).toHaveAttribute('decoding', 'async')
  })
})
