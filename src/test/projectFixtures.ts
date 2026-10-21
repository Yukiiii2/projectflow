export const testMember = { id: 'maya', name: 'Maya Chen', email: 'maya@northstar.studio', role: 'owner' }

const project = (workspaceId: string, id: string, name: string, total: number, complete: number, due: string) => ({
  id, workspace_id: workspaceId, name, description: `${name} delivery plan.`, created_at: '2026-10-01T00:00:00.000Z', archived_at: null,
  task_count: total, completed_task_count: complete, next_due_date: due,
})

export function projectFixtures(workspaceId: string) {
  const harbor = workspaceId.startsWith('2222')
  return harbor ? [
    project(workspaceId, `${workspaceId}-p1`, 'Research hub', 24, 18, '2026-10-25'),
    project(workspaceId, `${workspaceId}-p2`, 'Billing refresh', 28, 21, '2026-11-02'),
    project(workspaceId, `${workspaceId}-p3`, 'Release site', 20, 15, '2026-11-06'),
  ] : [
    project(workspaceId, `${workspaceId}-p1`, 'Website redesign', 48, 36, '2026-10-23'),
    project(workspaceId, `${workspaceId}-p2`, 'Client portal', 36, 28, '2026-10-28'),
    project(workspaceId, `${workspaceId}-p3`, 'Mobile app', 32, 24, '2026-10-30'),
    project(workspaceId, `${workspaceId}-p4`, 'Brand system', 12, 8, '2026-10-21'),
  ]
}

export function taskFixtures(workspaceId: string) {
  const projects = projectFixtures(workspaceId)
  if (workspaceId.startsWith('2222')) return [
    task(workspaceId, projects[0].id, projects[0].name, 'research-summary', 'Share research summary', '2026-10-20', 'high'),
    task(workspaceId, projects[1].id, projects[1].name, 'invoice-review', 'Review invoice states', '2026-10-21', 'medium'),
  ]
  const due = ['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27']
  return [
    task(workspaceId, projects[0].id, projects[0].name, 'overdue-1', 'Resolve accessibility audit', '2026-10-17', 'high'),
    task(workspaceId, projects[1].id, projects[1].name, 'overdue-2', 'Confirm account states', '2026-10-18', 'high'),
    task(workspaceId, projects[2].id, projects[2].name, 'overdue-3', 'Review onboarding notes', '2026-10-19', 'medium'),
    ...due.map((date, index) => task(workspaceId, projects[index % projects.length].id, projects[index % projects.length].name, `due-${index}`, index === 0 ? 'Review homepage wireframes' : `Due task ${index + 1}`, date, index < 2 ? 'high' : 'medium')),
  ]
}

function task(workspaceId: string, projectId: string, projectName: string, id: string, title: string, dueDate: string, priority: string) {
  return {
    id, project_id: projectId, workspace_id: workspaceId, project_name: projectName, title, description: '', status: 'in_progress', priority,
    due_date: dueDate, assignee_id: testMember.id, assignee_name: testMember.name, assignee_email: testMember.email,
    created_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
  }
}

export function projectApiFixture(url: string, method = 'GET') {
  const match = url.match(/\/api\/workspaces\/([^/]+)\/(projects|tasks|members)$/)
  if (match && method === 'GET') {
    const [, workspaceId, resource] = match
    if (resource === 'projects') return { projects: projectFixtures(workspaceId) }
    if (resource === 'tasks') return { tasks: taskFixtures(workspaceId) }
    return { members: [testMember] }
  }
  const taskMatch = url.match(/\/api\/tasks\/([^/]+)$/)
  if (taskMatch && method === 'PATCH') {
    const existing = taskFixtures('11111111-1111-4111-8111-111111111111').find((item) => item.id === taskMatch[1])
    return existing ? { task: { ...existing, status: 'done' } } : null
  }
  return null
}
