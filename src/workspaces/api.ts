import { apiRequest } from '../auth/api'

export type WorkspaceRole = 'owner' | 'admin' | 'member'

export interface WorkspaceSummary {
  id: string
  name: string
  role: WorkspaceRole
  created_at: string
}

interface WorkspaceListResponse {
  workspaces: WorkspaceSummary[]
}

interface WorkspaceResponse {
  workspace: WorkspaceSummary
}

export async function loadWorkspaces() {
  const response = await apiRequest<WorkspaceListResponse>('/api/workspaces')
  return response.workspaces
}

export async function createWorkspace(name: string) {
  const response = await apiRequest<WorkspaceResponse>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return response.workspace
}
