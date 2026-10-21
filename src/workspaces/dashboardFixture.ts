import { getWorkspace } from '../domain/dashboard'
import type { Workspace } from '../domain/types'
import type { WorkspaceSummary } from './api'

export function workspaceInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PF'
}

function templateIdFor(workspace: WorkspaceSummary) {
  if (/harbor/i.test(workspace.name)) return 'harbor'
  if (/northstar/i.test(workspace.name)) return 'northstar'
  const { id } = workspace
  const finalHex = id.match(/[0-9a-f]$/i)?.[0]
  return finalHex && Number.parseInt(finalHex, 16) % 2 === 0 ? 'harbor' : 'northstar'
}

export function dashboardFixtureFor(workspace: WorkspaceSummary): Workspace {
  const template = getWorkspace(templateIdFor(workspace))
  return {
    ...template,
    id: workspace.id,
    name: workspace.name,
    initials: workspaceInitials(workspace.name),
    plan: `${workspace.role[0].toUpperCase()}${workspace.role.slice(1)} workspace`,
  }
}
