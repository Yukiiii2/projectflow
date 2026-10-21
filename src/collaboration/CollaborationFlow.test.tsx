import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { TaskComment } from './api'

const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'Jordan Lee', email: 'owner@example.com' }
const member = { id: '22222222-2222-4222-8222-222222222222', name: 'Maya Chen', email: 'maya@example.com', role: 'member', joined_at: '2026-10-20T00:00:00.000Z' }
const workspace = { id: '33333333-3333-4333-8333-333333333333', name: 'Northstar Studio', role: 'owner', created_at: '2026-10-20T00:00:00.000Z' }
const project = { id: '44444444-4444-4444-8444-444444444444', workspace_id: workspace.id, name: 'Launch', description: '', created_at: '', archived_at: null, task_count: 1, completed_task_count: 0, next_due_date: null }
const task = { id: '55555555-5555-4555-8555-555555555555', project_id: project.id, workspace_id: workspace.id, project_name: project.name, title: 'Review release', description: '', status: 'todo', priority: 'medium', due_date: null, assignee_id: member.id, assignee_name: member.name, assignee_email: member.email, created_at: '', updated_at: '' }
const invitation = { id: '66666666-6666-4666-8666-666666666666', workspace_id: workspace.id, email: 'alex@example.com', role: 'member', status: 'pending', created_at: '2026-10-20T00:00:00.000Z', expires_at: '2026-10-27T00:00:00.000Z', accepted_at: null, revoked_at: null, invited_by_id: owner.id, invited_by_name: owner.name }
const fetchMock = vi.fn<typeof fetch>()
const response = (status: number, body?: unknown) => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function installApi() {
  let invitations = [invitation]
  let members = [{ ...owner, role: 'owner', joined_at: '2026-10-20T00:00:00.000Z' }, member]
  let comments: TaskComment[] = [{ id: '77777777-7777-4777-8777-777777777777', task_id: task.id, body: 'Ready for review.', author_id: owner.id, author_name: owner.name, author_email: owner.email, created_at: '2026-10-20T10:00:00.000Z', edited_at: null, can_edit: true, can_delete: true }]
  fetchMock.mockImplementation((input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.endsWith('/api/auth/me')) return response(200, { user: owner })
    if (url.endsWith('/api/workspaces')) return response(200, { workspaces: [workspace] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/projects`)) return response(200, { projects: [project] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/tasks`)) return response(200, { tasks: [task] })
    if (url.endsWith(`/api/workspaces/${workspace.id}/members`) && method === 'GET') return response(200, { members })
    if (url.endsWith(`/api/workspaces/${workspace.id}/invitations`) && method === 'GET') return response(200, { invitations })
    if (url.endsWith(`/api/workspaces/${workspace.id}/invitations`) && method === 'POST') {
      const created = { ...invitation, id: '88888888-8888-4888-8888-888888888888', email: body.email, role: body.role }
      invitations = [created, ...invitations]
      return response(201, { invitation: created, delivery: { status: 'preview', preview_url: 'http://localhost:5173/invite/test-token' } })
    }
    if (url.includes(`/api/workspaces/${workspace.id}/members/`) && method === 'PATCH') {
      members = members.map((item) => item.id === member.id ? { ...item, role: body.role } : item)
      return response(200, { member: members.find((item) => item.id === member.id) })
    }
    if (url.endsWith(`/api/tasks/${task.id}/comments`) && method === 'GET') return response(200, { comments })
    if (url.endsWith(`/api/tasks/${task.id}/comments`) && method === 'POST') {
      const created = { ...comments[0], id: '99999999-9999-4999-8999-999999999999', body: body.body }
      comments = [...comments, created]
      return response(201, { comment: created })
    }
    if (url.endsWith(`/api/comments/${comments[0].id}`) && method === 'PATCH') {
      comments = comments.map((item) => item.id === comments[0].id ? { ...item, body: body.body, edited_at: '2026-10-20T11:00:00.000Z' } : item)
      return response(200, { comment: comments[0] })
    }
    if (url.endsWith(`/api/tasks/${task.id}/activity`)) return response(200, { activity: [{ id: 'event-1', action: 'task.updated', metadata: { fields: ['status'], status: 'todo' }, created_at: '2026-10-20T09:00:00.000Z', actor_id: owner.id, actor_name: owner.name }] })
    return response(404, { error: 'Route not found' })
  })
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear() })

describe('Stage E collaboration UI', () => {
  it('closes the invitation dialog with Escape and restores trigger focus', async () => {
    installApi(); window.history.replaceState({}, '', '/team'); const visitor = userEvent.setup(); render(<App />)
    const trigger = await screen.findByRole('button', { name: 'Invite member' })
    await visitor.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Invite a teammate' })).toBeInTheDocument()

    await visitor.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Invite a teammate' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('manages workspace members and creates a preview invitation', async () => {
    installApi(); window.history.replaceState({}, '', '/team'); const visitor = userEvent.setup(); render(<App />)
    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(await screen.findByText('Maya Chen')).toBeInTheDocument()
    await visitor.selectOptions(screen.getByLabelText('Role for Maya Chen'), 'admin')
    expect(await screen.findByText('Maya Chen is now an admin.')).toBeInTheDocument()
    await visitor.click(screen.getByRole('button', { name: 'Invite member' }))
    const dialog = screen.getByRole('dialog', { name: 'Invite a teammate' })
    await visitor.type(within(dialog).getByLabelText('Email address'), 'new@example.com')
    await visitor.click(within(dialog).getByRole('button', { name: 'Create invitation' }))
    expect(await screen.findByText('Preview invitation ready')).toBeInTheDocument()
    expect(screen.getByDisplayValue('http://localhost:5173/invite/test-token')).toBeInTheDocument()
  })

  it('loads, creates, edits, and displays task comments and activity', async () => {
    installApi(); window.history.replaceState({}, '', '/tasks'); const visitor = userEvent.setup(); render(<App />)
    await visitor.click(await screen.findByText('Review release'))
    await visitor.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(await screen.findByText('Ready for review.')).toBeInTheDocument()
    await visitor.type(screen.getByLabelText('Add a comment'), 'Looks good to ship.')
    await visitor.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(await screen.findByText('Looks good to ship.')).toBeInTheDocument()
    await visitor.click(screen.getAllByRole('button', { name: 'Edit comment' })[0]!)
    const editor = screen.getByRole('textbox', { name: 'Edit comment' })
    await visitor.clear(editor); await visitor.type(editor, 'Ready for final review.')
    await visitor.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(await screen.findByText('Ready for final review.')).toBeInTheDocument()
    await visitor.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/moved this task to todo/i)).toBeInTheDocument()
  })
})
