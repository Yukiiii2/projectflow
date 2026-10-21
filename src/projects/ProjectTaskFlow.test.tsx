import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

const user = { id: 'user-1', name: 'Jordan Lee', email: 'jordan@example.com' }
const workspace = { id: '11111111-1111-4111-8111-111111111111', name: 'Northstar Studio', role: 'owner', created_at: '2026-10-20T00:00:00.000Z' }
const memberWorkspace = { ...workspace, role: 'member' }
const project = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspace_id: workspace.id,
  name: 'Website refresh',
  description: 'Refresh the public site.',
  created_at: '2026-10-20T00:00:00.000Z',
  archived_at: null,
  task_count: 2,
  completed_task_count: 1,
  next_due_date: '2026-10-21',
}
const tasks = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: project.id, workspace_id: workspace.id,
    project_name: project.name, title: 'Ship homepage', description: '', status: 'in_progress', priority: 'high',
    due_date: '2026-10-21', assignee_id: user.id, assignee_name: user.name, assignee_email: user.email,
    created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', project_id: project.id, workspace_id: workspace.id,
    project_name: project.name, title: 'Approve launch copy', description: '', status: 'done', priority: 'medium',
    due_date: '2026-10-19', assignee_id: user.id, assignee_name: user.name, assignee_email: user.email,
    created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
  },
]
const members = [{ ...user, role: 'owner' }]

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const fetchMock = vi.fn<typeof fetch>()

function installApi(role: 'owner' | 'member' = 'owner') {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/auth/me')) return json(200, { user })
    if (url.endsWith('/api/workspaces')) return json(200, { workspaces: [role === 'owner' ? workspace : memberWorkspace] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/projects`) && method === 'POST') {
      return json(201, { project: { ...project, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Client portal', description: 'Secure client workspace.', task_count: 0, completed_task_count: 0, next_due_date: null } })
    }
    if (url.endsWith(`/api/workspaces/${workspace.id}/projects`)) return json(200, { projects: [project] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/tasks`)) return json(200, { tasks })
    if (url.endsWith(`/api/workspaces/${workspace.id}/members`)) return json(200, { members })
    if (url.endsWith(`/api/projects/${project.id}/tasks`) && method === 'POST') {
      return json(201, { task: { ...tasks[0], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Review responsive layouts', status: 'todo', priority: 'medium', due_date: '2026-10-24' } })
    }
    return json(404, { error: 'Route not found' })
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('Stage C project and task integration', () => {
  it('renders dashboard project and task metrics from the API', async () => {
    installApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(await screen.findByTestId('active-projects-value')).toHaveTextContent('1')
    expect(screen.getByTestId('tasks-completed-value')).toHaveTextContent('1 / 2')
    expect(screen.getAllByText('Website refresh').length).toBeGreaterThan(0)
    expect(screen.getByText('Ship homepage')).toBeInTheDocument()
    expect(screen.queryByText('Review homepage wireframes')).not.toBeInTheDocument()
  })

  it('lists and creates projects for workspace owners', async () => {
    installApi()
    const visitor = userEvent.setup()
    render(<App />)

    await visitor.click(within(await screen.findByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    await visitor.click(screen.getByRole('button', { name: 'Create project' }))
    const dialog = screen.getByRole('dialog', { name: 'Create project' })
    await visitor.type(within(dialog).getByLabelText('Project name'), 'Client portal')
    await visitor.type(within(dialog).getByLabelText('Description'), 'Secure client workspace.')
    await visitor.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText('Client portal')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith(`/api/workspaces/${workspace.id}/projects`) && init?.method === 'POST')
    expect(call?.[1]).toEqual(expect.objectContaining({ credentials: 'include' }))
  })

  it('opens a real project and creates an assigned task', async () => {
    installApi()
    const visitor = userEvent.setup()
    render(<App />)

    await visitor.click(within(await screen.findByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Projects' }))
    await visitor.click(await screen.findByRole('link', { name: /Open Website refresh/ }))
    expect(await screen.findByRole('heading', { name: 'Website refresh' })).toBeInTheDocument()
    await visitor.click(within(screen.getByRole('main')).getByRole('button', { name: 'Create task' }))
    const panel = screen.getByRole('dialog', { name: 'Create task' })
    await visitor.type(within(panel).getByLabelText('Task title'), 'Review responsive layouts')
    await visitor.selectOptions(within(panel).getByLabelText('Assignee'), user.id)
    await visitor.selectOptions(within(panel).getByLabelText('Priority'), 'medium')
    await visitor.type(within(panel).getByLabelText('Due date'), '2026-10-24')
    await visitor.click(within(panel).getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Review responsive layouts')).toBeInTheDocument()
  })

  it('hides project-management actions from members while allowing task work', async () => {
    installApi('member')
    const visitor = userEvent.setup()
    render(<App />)

    await visitor.click(within(await screen.findByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument()
    expect(screen.getByText('Only workspace owners and admins can create or edit projects.')).toBeInTheDocument()

    await visitor.click(screen.getByRole('link', { name: /Open Website refresh/ }))
    expect(await within(screen.getByRole('main')).findByRole('button', { name: 'Create task' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument()
  })
})
