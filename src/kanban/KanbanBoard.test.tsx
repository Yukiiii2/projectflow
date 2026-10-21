import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

const user = { id: 'user-1', name: 'Jordan Lee', email: 'jordan@example.com' }
const workspace = { id: '11111111-1111-4111-8111-111111111111', name: 'Northstar Studio', role: 'owner', created_at: '2026-10-20T00:00:00.000Z' }
const project = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace_id: workspace.id, name: 'Website refresh', description: 'Refresh the public site.', created_at: '2026-10-20T00:00:00.000Z', archived_at: null, task_count: 3, completed_task_count: 1, next_due_date: '2026-10-24' }
const baseTasks = [
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: project.id, workspace_id: workspace.id, project_name: project.name, title: 'Plan navigation', description: 'Audit current routes.', status: 'todo', priority: 'high', due_date: '2026-10-24', assignee_id: user.id, assignee_name: user.name, assignee_email: user.email, created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z' },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', project_id: project.id, workspace_id: workspace.id, project_name: project.name, title: 'Build header', description: '', status: 'in_progress', priority: 'medium', due_date: null, assignee_id: null, assignee_name: null, assignee_email: null, created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z' },
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', project_id: project.id, workspace_id: workspace.id, project_name: project.name, title: 'Approve copy', description: '', status: 'done', priority: 'low', due_date: '2026-10-20', assignee_id: user.id, assignee_name: user.name, assignee_email: user.email, created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z' },
]
const members = [{ ...user, role: 'owner' }]
const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown) { return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) }

function installApi(failFirstMove = false) {
  let tasks = baseTasks.map((task) => ({ ...task }))
  let failed = false
  fetchMock.mockImplementation((input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'
    if (url.endsWith('/api/auth/me')) return json(200, { user })
    if (url.endsWith('/api/workspaces')) return json(200, { workspaces: [workspace] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/projects`)) return json(200, { projects: [project] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/tasks`)) return json(200, { tasks })
    if (url.endsWith(`/api/workspaces/${workspace.id}/members`)) return json(200, { members })
    if (url.includes('/api/tasks/') && method === 'PATCH') {
      if (failFirstMove && !failed) { failed = true; return json(500, { error: 'Temporary database error' }) }
      const id = url.split('/').at(-1); const body = JSON.parse(String(init?.body ?? '{}'))
      const current = tasks.find((task) => task.id === id)!
      const updated = { ...current, ...body, due_date: body.dueDate ?? current.due_date, assignee_id: body.assigneeId ?? current.assignee_id }
      tasks = tasks.map((task) => task.id === id ? updated : task)
      return json(200, { task: updated })
    }
    return json(404, { error: 'Route not found' })
  })
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); window.history.replaceState({}, '', '/board') })
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

describe('Stage D Kanban board', () => {
  it('groups real tasks by status and exposes task metadata', async () => {
    installApi(); render(<App />)
    expect(await screen.findByRole('heading', { name: 'Kanban board' })).toBeInTheDocument()
    expect(within(await screen.findByTestId('kanban-column-todo')).getByText('Plan navigation')).toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-column-in_progress')).getByText('Build header')).toBeInTheDocument()
    expect(within(screen.getByTestId('kanban-column-done')).getByText('Approve copy')).toBeInTheDocument()
    expect(screen.getAllByText('Jordan Lee')).not.toHaveLength(0)
    expect(screen.getByText('Oct 24')).toBeInTheDocument()
  })

  it('moves a task through the keyboard-accessible status control and offers undo', async () => {
    installApi(); const visitor = userEvent.setup(); render(<App />)
    const move = await screen.findByLabelText('Move Plan navigation')
    await visitor.selectOptions(move, 'in_progress')
    expect(await within(screen.getByTestId('kanban-column-in_progress')).findByText('Plan navigation')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Plan navigation moved to In progress')
    await visitor.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(await within(screen.getByTestId('kanban-column-todo')).findByText('Plan navigation')).toBeInTheDocument()
  })

  it('supports drag and drop status changes', async () => {
    installApi(); render(<App />)
    const card = await screen.findByTestId(`kanban-task-${baseTasks[0].id}`)
    const target = screen.getByTestId('kanban-column-done')
    const data = new Map<string, string>()
    const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', effectAllowed: 'move', dropEffect: 'move' }
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(await within(target).findByText('Plan navigation')).toBeInTheDocument()
  })

  it('keeps the original column after a failed move and supports retry and dismissal', async () => {
    installApi(true); const visitor = userEvent.setup(); render(<App />)
    await visitor.selectOptions(await screen.findByLabelText('Move Plan navigation'), 'done')
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be moved')
    expect(within(screen.getByTestId('kanban-column-todo')).getByText('Plan navigation')).toBeInTheDocument()
    await visitor.click(screen.getByRole('button', { name: 'Retry move' }))
    expect(await within(screen.getByTestId('kanban-column-done')).findByText('Plan navigation')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
