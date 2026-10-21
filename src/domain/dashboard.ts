import type {
  CompletionSeries,
  DashboardPeriod,
  DashboardSnapshot,
  Person,
  Workspace,
} from './types'

const maya: Person = { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#8B6BE8' }
const alex: Person = { id: 'alex', name: 'Alex Rivera', initials: 'AR', color: '#4C8CF5' }
const sam: Person = { id: 'sam', name: 'Sam Patel', initials: 'SP', color: '#32B783' }
const nina: Person = { id: 'nina', name: 'Nina Park', initials: 'NP', color: '#E69B3A' }

const northstar: Workspace = {
  id: 'northstar',
  name: 'Northstar Studio',
  plan: 'Team workspace',
  initials: 'NS',
  projects: [
    {
      id: 'website-redesign',
      name: 'Website redesign',
      completedTasks: 36,
      taskTotal: 48,
      dueLabel: 'Oct 23',
      dueISO: '2026-10-23',
      owner: maya,
      memberCount: 6,
      accent: '#8B6BE8',
    },
    {
      id: 'client-portal',
      name: 'Client portal',
      completedTasks: 28,
      taskTotal: 36,
      dueLabel: 'Oct 28',
      dueISO: '2026-10-28',
      owner: alex,
      memberCount: 4,
      accent: '#4C8CF5',
    },
    {
      id: 'mobile-app',
      name: 'Mobile app',
      completedTasks: 24,
      taskTotal: 32,
      dueLabel: 'Oct 30',
      dueISO: '2026-10-30',
      owner: sam,
      memberCount: 3,
      accent: '#32B783',
    },
    {
      id: 'brand-system',
      name: 'Brand system',
      completedTasks: 8,
      taskTotal: 12,
      dueLabel: 'Oct 21',
      dueISO: '2026-10-21',
      owner: nina,
      memberCount: 2,
      accent: '#E69B3A',
    },
  ],
  upcomingTasks: [
    {
      id: 'review-homepage-wireframes',
      title: 'Review homepage wireframes',
      project: 'Website redesign',
      dueLabel: 'Today',
      dueISO: '2026-10-19',
      priority: 'high',
      assignee: maya,
    },
    {
      id: 'finalize-authentication-flow',
      title: 'Finalize authentication flow',
      project: 'Client portal',
      dueLabel: 'Today',
      dueISO: '2026-10-19',
      priority: 'high',
      assignee: alex,
    },
    {
      id: 'qa-mobile-onboarding',
      title: 'QA mobile onboarding',
      project: 'Mobile app',
      dueLabel: 'Tomorrow',
      dueISO: '2026-10-20',
      priority: 'medium',
      assignee: sam,
    },
    {
      id: 'approve-color-tokens',
      title: 'Approve color tokens',
      project: 'Brand system',
      dueLabel: 'Oct 21',
      dueISO: '2026-10-21',
      priority: 'low',
      assignee: nina,
    },
  ],
  activities: [
    {
      id: 'activity-1',
      person: maya,
      verb: 'completed',
      subject: 'Navigation audit',
      project: 'Website redesign',
      time: '18 min ago',
    },
    {
      id: 'activity-2',
      person: sam,
      verb: 'commented on',
      subject: 'Onboarding QA',
      project: 'Mobile app',
      time: '42 min ago',
    },
    {
      id: 'activity-3',
      person: alex,
      verb: 'assigned',
      subject: 'Authentication flow',
      project: 'Client portal',
      time: '1 hr ago',
    },
    {
      id: 'activity-4',
      person: nina,
      verb: 'updated',
      subject: 'the color palette',
      project: 'Brand system',
      time: '2 hr ago',
    },
  ],
  dueThisWeek: 8,
  overdueTasks: 3,
  completionSeries: {
    '7d': { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [58, 61, 65, 67, 70, 72, 75] },
    '30d': { labels: ['Sep 20', 'Sep 27', 'Oct 4', 'Oct 11', 'Oct 19'], values: [42, 50, 59, 68, 75] },
    '90d': { labels: ['Jul', 'Aug', 'Sep', 'Oct'], values: [24, 39, 58, 75] },
  },
}

const harbor: Workspace = {
  id: 'harbor',
  name: 'Harbor Labs',
  plan: 'Client workspace',
  initials: 'HL',
  projects: [
    {
      id: 'research-hub',
      name: 'Research hub',
      completedTasks: 18,
      taskTotal: 24,
      dueLabel: 'Oct 25',
      dueISO: '2026-10-25',
      owner: alex,
      memberCount: 4,
      accent: '#8B6BE8',
    },
    {
      id: 'billing-refresh',
      name: 'Billing refresh',
      completedTasks: 21,
      taskTotal: 28,
      dueLabel: 'Nov 2',
      dueISO: '2026-11-02',
      owner: nina,
      memberCount: 3,
      accent: '#4C8CF5',
    },
    {
      id: 'release-site',
      name: 'Release site',
      completedTasks: 15,
      taskTotal: 20,
      dueLabel: 'Nov 6',
      dueISO: '2026-11-06',
      owner: sam,
      memberCount: 5,
      accent: '#32B783',
    },
  ],
  upcomingTasks: [
    {
      id: 'research-summary',
      title: 'Share research summary',
      project: 'Research hub',
      dueLabel: 'Today',
      dueISO: '2026-10-19',
      priority: 'high',
      assignee: alex,
    },
    {
      id: 'invoice-review',
      title: 'Review invoice states',
      project: 'Billing refresh',
      dueLabel: 'Tomorrow',
      dueISO: '2026-10-20',
      priority: 'medium',
      assignee: nina,
    },
    {
      id: 'release-copy',
      title: 'Approve release copy',
      project: 'Release site',
      dueLabel: 'Oct 22',
      dueISO: '2026-10-22',
      priority: 'low',
      assignee: sam,
    },
  ],
  activities: [
    {
      id: 'harbor-activity-1',
      person: alex,
      verb: 'shared',
      subject: 'Research synthesis',
      project: 'Research hub',
      time: '12 min ago',
    },
    {
      id: 'harbor-activity-2',
      person: nina,
      verb: 'updated',
      subject: 'Invoice states',
      project: 'Billing refresh',
      time: '55 min ago',
    },
    {
      id: 'harbor-activity-3',
      person: sam,
      verb: 'commented on',
      subject: 'Release messaging',
      project: 'Release site',
      time: '2 hr ago',
    },
  ],
  dueThisWeek: 5,
  overdueTasks: 1,
  completionSeries: {
    '7d': { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [61, 63, 66, 68, 70, 72, 75] },
    '30d': { labels: ['Sep 20', 'Sep 27', 'Oct 4', 'Oct 11', 'Oct 19'], values: [46, 51, 57, 66, 75] },
    '90d': { labels: ['Jul', 'Aug', 'Sep', 'Oct'], values: [30, 44, 59, 75] },
  },
}

export const workspaces = [northstar, harbor] as const

export const dashboardPeriods: { id: DashboardPeriod; label: string; shortLabel: string }[] = [
  { id: '7d', label: 'Last 7 days', shortLabel: '7 days' },
  { id: '30d', label: 'Last 30 days', shortLabel: '30 days' },
  { id: '90d', label: 'Last 90 days', shortLabel: '90 days' },
]

export function getWorkspace(id: string): Workspace {
  return workspaces.find((workspace) => workspace.id === id) ?? northstar
}

export function getDashboardSnapshot(workspace: Workspace, localCompletedCount = 0): DashboardSnapshot {
  const totalTasks = workspace.projects.reduce((sum, project) => sum + project.taskTotal, 0)
  const baseCompleted = workspace.projects.reduce((sum, project) => sum + project.completedTasks, 0)
  const completedTasks = Math.min(totalTasks, baseCompleted + Math.max(0, localCompletedCount))

  return {
    activeProjects: workspace.projects.length,
    completedTasks,
    totalTasks,
    dueThisWeek: Math.max(0, workspace.dueThisWeek - localCompletedCount),
    overdueTasks: workspace.overdueTasks,
    completionRate: totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
  }
}

export function getCompletionSeries(workspace: Workspace, period: DashboardPeriod): CompletionSeries {
  return workspace.completionSeries[period]
}
