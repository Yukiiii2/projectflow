import { apiRequest } from '../auth/api'
import type { WorkspaceRole } from '../workspaces/api'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface ProjectSummary {
  id: string
  workspace_id: string
  name: string
  description: string
  created_at: string
  archived_at: string | null
  task_count: number
  completed_task_count: number
  next_due_date: string | null
}

export interface ProjectTask {
  id: string
  project_id: string
  workspace_id: string
  project_name: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  assignee_id: string | null
  assignee_name: string | null
  assignee_email: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  id: string
  name: string
  email: string
  role: WorkspaceRole
  joined_at?: string
}

export interface ProjectInput {
  name: string
  description: string
}

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string | null
  assigneeId?: string | null
}

const normalizeDate = (value: unknown) => typeof value === 'string' ? value.slice(0, 10) : null
const normalizeProject = (project: ProjectSummary): ProjectSummary => ({
  ...project,
  task_count: Number(project.task_count),
  completed_task_count: Number(project.completed_task_count),
  next_due_date: normalizeDate(project.next_due_date),
})
const normalizeTask = (task: ProjectTask): ProjectTask => ({ ...task, due_date: normalizeDate(task.due_date) })

export async function listProjects(workspaceId: string) {
  const response = await apiRequest<{ projects: ProjectSummary[] }>(`/api/workspaces/${workspaceId}/projects`)
  return response.projects.map(normalizeProject)
}

export async function listWorkspaceTasks(workspaceId: string) {
  const response = await apiRequest<{ tasks: ProjectTask[] }>(`/api/workspaces/${workspaceId}/tasks`)
  return response.tasks.map(normalizeTask)
}

export async function listWorkspaceMembers(workspaceId: string) {
  const response = await apiRequest<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members`)
  return response.members
}

export async function createProject(workspaceId: string, input: ProjectInput) {
  const response = await apiRequest<{ project: ProjectSummary }>(`/api/workspaces/${workspaceId}/projects`, {
    method: 'POST', body: JSON.stringify(input),
  })
  return normalizeProject(response.project)
}

export async function updateProject(projectId: string, input: Partial<ProjectInput>) {
  const response = await apiRequest<{ project: ProjectSummary }>(`/api/projects/${projectId}`, {
    method: 'PATCH', body: JSON.stringify(input),
  })
  return normalizeProject(response.project)
}

export async function archiveProject(projectId: string) {
  await apiRequest(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
}

export async function createTask(projectId: string, input: TaskInput) {
  const response = await apiRequest<{ task: ProjectTask }>(`/api/projects/${projectId}/tasks`, {
    method: 'POST', body: JSON.stringify(input),
  })
  return normalizeTask(response.task)
}

export async function updateTask(taskId: string, input: Partial<TaskInput>) {
  const response = await apiRequest<{ task: ProjectTask }>(`/api/tasks/${taskId}`, {
    method: 'PATCH', body: JSON.stringify(input),
  })
  return normalizeTask(response.task)
}
