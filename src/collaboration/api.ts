import { apiRequest } from '../auth/api'
import type { WorkspaceRole, WorkspaceSummary } from '../workspaces/api'

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface WorkspaceInvitation {
  id: string
  workspace_id: string
  email: string
  role: Exclude<WorkspaceRole, 'owner'>
  status: InvitationStatus
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  invited_by_id: string
  invited_by_name: string
}

export interface InvitationPreview {
  email: string
  role: Exclude<WorkspaceRole, 'owner'>
  status: InvitationStatus
  expires_at: string
  workspace_name: string
  invited_by_name: string
}

export interface TaskComment {
  id: string
  task_id: string
  body: string
  author_id: string
  author_name: string
  author_email: string
  created_at: string
  edited_at: string | null
  can_edit: boolean
  can_delete: boolean
}

export interface TaskActivity {
  id: string
  action: string
  metadata: Record<string, unknown>
  created_at: string
  actor_id: string | null
  actor_name: string | null
}

export async function listInvitations(workspaceId: string) {
  return (await apiRequest<{ invitations: WorkspaceInvitation[] }>(`/api/workspaces/${workspaceId}/invitations`)).invitations
}

export async function createInvitation(workspaceId: string, email: string, role: 'admin' | 'member') {
  return apiRequest<{ invitation: WorkspaceInvitation; delivery: { status: 'preview' | 'sent'; preview_url?: string } }>(`/api/workspaces/${workspaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) })
}

export async function revokeInvitation(workspaceId: string, invitationId: string) {
  return (await apiRequest<{ invitation: WorkspaceInvitation }>(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, { method: 'DELETE' })).invitation
}

export async function changeMemberRole(workspaceId: string, memberId: string, role: 'admin' | 'member') {
  return apiRequest(`/api/workspaces/${workspaceId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export async function removeMember(workspaceId: string, memberId: string) {
  return apiRequest(`/api/workspaces/${workspaceId}/members/${memberId}`, { method: 'DELETE' })
}

export async function getInvitation(token: string) {
  return (await apiRequest<{ invitation: InvitationPreview }>(`/api/invitations/${encodeURIComponent(token)}`)).invitation
}

export async function acceptInvitation(token: string) {
  return (await apiRequest<{ workspace: WorkspaceSummary }>(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' })).workspace
}

export async function listComments(taskId: string) {
  return (await apiRequest<{ comments: TaskComment[] }>(`/api/tasks/${taskId}/comments`)).comments
}

export async function createComment(taskId: string, body: string) {
  return (await apiRequest<{ comment: TaskComment }>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body }) })).comment
}

export async function updateComment(commentId: string, body: string) {
  return (await apiRequest<{ comment: TaskComment }>(`/api/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) })).comment
}

export async function deleteComment(commentId: string) {
  return apiRequest<void>(`/api/comments/${commentId}`, { method: 'DELETE' })
}

export async function listTaskActivity(taskId: string) {
  return (await apiRequest<{ activity: TaskActivity[] }>(`/api/tasks/${taskId}/activity`)).activity
}
