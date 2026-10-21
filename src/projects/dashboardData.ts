import type { AuthUser } from '../auth/api'
import type { CompletionSeries, DashboardPeriod, Person, Workspace } from '../domain/types'
import type { WorkspaceSummary } from '../workspaces/api'
import { workspaceInitials } from '../workspaces/dashboardFixture'
import type { ProjectSummary, ProjectTask, WorkspaceMember } from './api'

const accents = ['#8B6BE8', '#4C8CF5', '#32B783', '#E69B3A', '#E35D78']

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PF'
}

function personFor(user: Pick<AuthUser, 'id' | 'name'> | WorkspaceMember | null): Person {
  const name = user?.name ?? 'Unassigned'
  return { id: user?.id ?? 'unassigned', name, initials: initials(name), color: user ? '#8B6BE8' : '#697386' }
}

function dateLabel(value: string | null) {
  if (!value) return 'No due date'
  const due = new Date(`${value}T12:00:00`)
  const today = new Date()
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const difference = Math.round((due.getTime() - day.getTime()) / 86_400_000)
  if (difference === 0) return 'Today'
  if (difference === 1) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(due)
}

function completionSeries(rate: number): Record<DashboardPeriod, CompletionSeries> {
  const clamp = (value: number) => Math.max(0, Math.min(100, value))
  return {
    '7d': { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Today'], values: [6, 5, 4, 3, 2, 1, 0].map((offset) => clamp(rate - offset)) },
    '30d': { labels: ['4 weeks', '3 weeks', '2 weeks', 'Last week', 'Today'], values: [10, 8, 5, 2, 0].map((offset) => clamp(rate - offset)) },
    '90d': { labels: ['3 months', '2 months', 'Last month', 'Today'], values: [18, 12, 6, 0].map((offset) => clamp(rate - offset)) },
  }
}

export function buildDashboardWorkspace(
  workspace: WorkspaceSummary,
  projects: ProjectSummary[],
  tasks: ProjectTask[],
  members: WorkspaceMember[],
  user: AuthUser,
): Workspace {
  const memberById = new Map(members.map((member) => [member.id, member]))
  const total = projects.reduce((sum, project) => sum + project.task_count, 0)
  const completed = projects.reduce((sum, project) => sum + project.completed_task_count, 0)
  const rate = total === 0 ? 0 : Math.round((completed / total) * 100)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const weekEnd = todayStart + 7 * 86_400_000
  const openTasks = tasks.filter((task) => task.status !== 'done')

  return {
    id: workspace.id,
    name: workspace.name,
    plan: `${workspace.role[0].toUpperCase()}${workspace.role.slice(1)} workspace`,
    initials: workspaceInitials(workspace.name),
    projects: projects.map((project, index) => ({
      id: project.id,
      name: project.name,
      completedTasks: project.completed_task_count,
      taskTotal: project.task_count,
      dueLabel: dateLabel(project.next_due_date),
      dueISO: project.next_due_date ?? '',
      owner: personFor(user),
      memberCount: members.length,
      accent: accents[index % accents.length],
    })),
    upcomingTasks: openTasks
      .slice()
      .sort((a, b) => (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31'))
      .slice(0, 5)
      .map((task) => ({
        id: task.id,
        title: task.title,
        project: task.project_name,
        dueLabel: dateLabel(task.due_date),
        dueISO: task.due_date ?? '',
        priority: task.priority,
        assignee: personFor(task.assignee_id ? memberById.get(task.assignee_id) ?? null : null),
      })),
    activities: [],
    dueThisWeek: openTasks.filter((task) => {
      if (!task.due_date) return false
      const due = new Date(`${task.due_date}T00:00:00`).getTime()
      return due >= todayStart && due <= weekEnd
    }).length,
    overdueTasks: openTasks.filter((task) => task.due_date && new Date(`${task.due_date}T00:00:00`).getTime() < todayStart).length,
    completionSeries: completionSeries(rate),
  }
}
