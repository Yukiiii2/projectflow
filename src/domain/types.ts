export type Priority = 'high' | 'medium' | 'low'
export type DashboardPeriod = '7d' | '30d' | '90d'
export type DashboardView = 'overview' | 'empty' | 'loading' | 'error'

export interface Person {
  id: string
  name: string
  initials: string
  color: string
}

export interface Project {
  id: string
  name: string
  completedTasks: number
  taskTotal: number
  dueLabel: string
  dueISO: string
  owner: Person
  memberCount: number
  accent: string
}

export interface Task {
  id: string
  title: string
  project: string
  dueLabel: string
  dueISO: string
  priority: Priority
  assignee: Person
}

export interface Activity {
  id: string
  person: Person
  verb: string
  subject: string
  project: string
  time: string
}

export interface CompletionSeries {
  labels: string[]
  values: number[]
}

export interface Workspace {
  id: string
  name: string
  plan: string
  initials: string
  projects: Project[]
  upcomingTasks: Task[]
  activities: Activity[]
  dueThisWeek: number
  overdueTasks: number
  completionSeries: Record<DashboardPeriod, CompletionSeries>
}

export interface DashboardSnapshot {
  activeProjects: number
  completedTasks: number
  totalTasks: number
  dueThisWeek: number
  overdueTasks: number
  completionRate: number
}
