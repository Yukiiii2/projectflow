import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDot,
  FolderKanban,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { dashboardPeriods, getCompletionSeries, getDashboardSnapshot } from '../domain/dashboard'
import type { DashboardPeriod, DashboardView, Priority, Workspace } from '../domain/types'
import { Avatar } from './Avatar'

interface DashboardProps {
  workspace: Workspace
  userName: string
  period: DashboardPeriod
  onPeriodChange: (period: DashboardPeriod) => void
  view: DashboardView
  onViewChange: (view: DashboardView) => void
  completedTaskIds: string[]
  onToggleTask: (taskId: string) => void
  onUnavailable: (feature: string) => void
  onRetry: () => void
  onCreateProject: () => void
  onCreateTask: () => void
  onOpenProjects: () => void
  onOpenProject: (projectId: string) => void
  onOpenTasks: () => void
  onOpenTask: (taskId: string) => void
}

const viewOptions: { id: DashboardView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'empty', label: 'Empty' },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Error' },
]

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'purple',
  testId,
}: {
  label: string
  value: string | number
  helper: string
  icon: React.ReactNode
  tone?: 'purple' | 'blue' | 'green' | 'danger'
  testId: string
}) {
  return (
    <article className="metric-card">
      <div className={`metric-card__icon metric-card__icon--${tone}`}>{icon}</div>
      <div className="metric-card__content">
        <span className="metric-card__label">{label}</span>
        <strong className="metric-card__value" data-testid={testId}>{value}</strong>
        <span className={`metric-card__helper ${tone === 'danger' ? 'is-danger' : ''}`}>{helper}</span>
      </div>
    </article>
  )
}

function PanelHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}

function ActiveProjects({ workspace, onOpenProjects, onOpenProject }: Pick<DashboardProps, 'workspace' | 'onOpenProjects' | 'onOpenProject'>) {
  return (
    <section className="panel projects-panel" aria-labelledby="active-projects-heading">
      <PanelHeader
        title="Active projects"
        description={`${workspace.projects.length} projects in progress`}
        action={
          <button type="button" className="text-button" onClick={onOpenProjects}>
            View all <ArrowRight size={15} />
          </button>
        }
      />
      <div className="project-list">
        {workspace.projects.map((project) => {
          const progress = project.taskTotal ? Math.round((project.completedTasks / project.taskTotal) * 100) : 0
          return (
            <button
              type="button"
              className="project-row"
              key={project.id}
              onClick={() => onOpenProject(project.id)}
            >
              <span className="project-row__mark" style={{ '--project-accent': project.accent } as CSSProperties}>
                <FolderKanban size={18} />
              </span>
              <span className="project-row__body">
                <span className="project-row__topline">
                  <strong>{project.name}</strong>
                  <span>{progress}%</span>
                </span>
                <span className="progress-track" aria-label={`${project.name} is ${progress}% complete`}>
                  <span style={{ width: `${progress}%`, '--project-accent': project.accent } as CSSProperties} />
                </span>
                <span className="project-row__meta">
                  <span>{project.completedTasks} of {project.taskTotal} tasks</span>
                  <span>Due <time dateTime={project.dueISO}>{project.dueLabel}</time></span>
                  <span>{project.memberCount} members</span>
                </span>
              </span>
              <Avatar person={project.owner} size="sm" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function CompletionChart({ workspace, period }: Pick<DashboardProps, 'workspace' | 'period'>) {
  const series = getCompletionSeries(workspace, period)
  const snapshot = getDashboardSnapshot(workspace)
  const width = 480
  const height = 168
  const leftInset = 38
  const rightInset = 18
  const verticalInset = 18
  const xStep = (width - leftInset - rightInset) / Math.max(1, series.values.length - 1)
  const points = series.values.map((value, index) => ({
    x: leftInset + index * xStep,
    y: height - verticalInset - (value / 100) * (height - verticalInset * 2),
  }))
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = `${line} L ${points.at(-1)?.x ?? 0} ${height - verticalInset} L ${points[0]?.x ?? 0} ${height - verticalInset} Z`
  const periodLabel = dashboardPeriods.find((item) => item.id === period)?.label ?? 'Last 30 days'

  return (
    <section className="panel completion-panel" aria-labelledby="task-completion-heading">
      <PanelHeader title="Task completion" description="Completed work across active projects" />
      <div className="completion-summary">
        <div>
          <strong>{series.values.at(-1)}%</strong>
          <small>{snapshot.completedTasks} of {snapshot.totalTasks} tasks completed</small>
          <span><TrendingUp size={14} /> Live workspace snapshot</span>
        </div>
        <span data-testid="completion-caption">{periodLabel}</span>
      </div>
      <div className="chart-wrap">
        <svg
          className="completion-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Task completion trend for ${periodLabel.toLowerCase()}, ending at ${series.values.at(-1)} percent`}
        >
          {[25, 50, 75].map((value) => {
            const y = height - verticalInset - (value / 100) * (height - verticalInset * 2)
            return (
              <g key={value} aria-hidden="true">
                <text x="3" y={y + 3} className="chart-axis-label">{value}%</text>
                <line x1={leftInset} x2={width - rightInset} y1={y} y2={y} className="chart-gridline" />
              </g>
            )
          })}
          <path d={area} className="chart-area" />
          <path d={line} className="chart-line" />
          {points.map((point, index) => (
            <circle key={series.labels[index]} cx={point.x} cy={point.y} r={index === points.length - 1 ? 4 : 2.5} className="chart-point" />
          ))}
        </svg>
        <div className="chart-labels" aria-hidden="true">
          {series.labels.map((label) => <span key={label}>{label}</span>)}
        </div>
      </div>
    </section>
  )
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority priority--${priority}`}>{priority}</span>
}

function UpcomingTasks({
  workspace,
  completedTaskIds,
  onToggleTask,
  onOpenTasks,
  onOpenTask,
}: Pick<DashboardProps, 'workspace' | 'completedTaskIds' | 'onToggleTask' | 'onOpenTasks' | 'onOpenTask'>) {
  return (
    <section className="panel tasks-panel" aria-labelledby="upcoming-tasks-heading">
      <PanelHeader
        title="Upcoming tasks"
        description="What needs attention next"
        action={
          <button type="button" className="text-button" onClick={onOpenTasks}>
            View all <ArrowRight size={15} />
          </button>
        }
      />
      <div className="task-list">
        {workspace.upcomingTasks.map((task) => {
          const completed = completedTaskIds.includes(task.id)
          return (
            <div className={`task-row ${completed ? 'is-complete' : ''}`} key={task.id}>
              <label className="task-check">
                <input
                  type="checkbox"
                  checked={completed}
                  onChange={() => onToggleTask(task.id)}
                  aria-label={`${completed ? 'Mark' : 'Mark'} ${task.title} ${completed ? 'incomplete' : 'complete'}`}
                />
                <span aria-hidden="true">{completed && <Check size={13} strokeWidth={3} />}</span>
              </label>
              <button type="button" className="task-row__body" onClick={() => onOpenTask(task.id)}>
                <strong>{task.title}</strong>
                <span>{task.project}</span>
              </button>
              <PriorityBadge priority={task.priority} />
              <time dateTime={task.dueISO} className={task.dueLabel === 'Today' ? 'is-today' : ''}>{task.dueLabel}</time>
              <Avatar person={task.assignee} size="sm" />
              <button
                type="button"
                className="row-action icon-button"
                aria-label={`Open actions for ${task.title}`}
                data-tooltip="Task actions"
                onClick={() => onOpenTask(task.id)}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RecentActivity({ workspace, onUnavailable }: Pick<DashboardProps, 'workspace' | 'onUnavailable'>) {
  return (
    <section className="panel activity-panel" aria-labelledby="recent-activity-heading">
      <PanelHeader title="Recent activity" description="Updates from your team" />
      <div className="activity-list">
        {workspace.activities.length === 0 && <div className="inline-empty inline-empty--activity"><CircleDot size={20} /><strong>No recent activity yet</strong><span>Project and task updates will appear here as your team works.</span></div>}
        {workspace.activities.map((activity) => (
          <button
            type="button"
            className="activity-row"
            key={activity.id}
            onClick={() => onUnavailable(`${activity.subject} activity`)}
          >
            <Avatar person={activity.person} size="sm" />
            <span className="activity-row__copy">
              <span><strong>{activity.person.name}</strong> {activity.verb} <b>{activity.subject}</b></span>
              <small>{activity.project} · {activity.time}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function EmptyDashboard({ onCreateProject, onUnavailable }: Pick<DashboardProps, 'onCreateProject' | 'onUnavailable'>) {
  return (
    <section className="state-card state-card--empty">
      <div className="state-illustration" aria-hidden="true">
        <span className="state-illustration__back" />
        <FolderKanban size={34} />
        <Sparkles size={19} />
      </div>
      <span className="eyebrow">Fresh workspace</span>
      <h2>Your workspace is ready for its first project</h2>
      <p>Create a project to organize tasks, invite collaborators, and make progress visible from day one.</p>
      <button type="button" className="button button--primary" onClick={onCreateProject}>
        <Plus size={17} /> Create first project
      </button>
      <button type="button" className="text-button" onClick={() => onUnavailable('Template gallery')}>Browse project templates</button>
    </section>
  )
}

function LoadingDashboard() {
  return (
    <section className="loading-dashboard" aria-busy="true" aria-label="Loading dashboard">
      <span className="sr-only">Loading dashboard</span>
      <div className="loading-metrics">
        {[0, 1, 2, 3].map((item) => <div className="skeleton skeleton--metric" key={item} />)}
      </div>
      <div className="loading-grid">
        <div className="skeleton skeleton--panel" />
        <div className="skeleton skeleton--panel" />
        <div className="skeleton skeleton--panel skeleton--wide" />
        <div className="skeleton skeleton--panel" />
      </div>
    </section>
  )
}

function ErrorDashboard({ onRetry }: Pick<DashboardProps, 'onRetry'>) {
  return (
    <section className="state-card state-card--error" role="alert">
      <div className="state-icon state-icon--danger"><AlertTriangle size={26} /></div>
      <span className="eyebrow">Connection interrupted</span>
      <h2>We could not load your dashboard</h2>
      <p>Your workspace data remains safe. Retry the connection to load projects and tasks.</p>
      <button type="button" className="button button--primary" onClick={onRetry}>
        <RefreshCcw size={17} /> Retry dashboard
      </button>
      <span className="error-code">Error reference · PF-DASH-01</span>
    </section>
  )
}

export function Dashboard({
  workspace,
  userName,
  period,
  onPeriodChange,
  view,
  onViewChange,
  completedTaskIds,
  onToggleTask,
  onUnavailable,
  onRetry,
  onCreateProject,
  onCreateTask,
  onOpenProjects,
  onOpenProject,
  onOpenTasks,
  onOpenTask,
}: DashboardProps) {
  const snapshot = getDashboardSnapshot(workspace, completedTaskIds.length)
  const firstName = userName.trim().split(/\s+/)[0] || 'there'

  return (
    <div className="dashboard-page">
      <section className="dashboard-heading" aria-labelledby="dashboard-title">
        <div>
          <span className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span>
          <h1 id="dashboard-title">Dashboard</h1>
          <p>Good morning, {firstName}. Here’s what’s moving across {workspace.name}.</p>
        </div>
        <div className="dashboard-heading__actions">
          <label className="select-control">
            <span className="sr-only">Reporting period</span>
            <CalendarClock size={16} aria-hidden="true" />
            <select aria-label="Reporting period" value={period} onChange={(event) => onPeriodChange(event.target.value as DashboardPeriod)}>
              {dashboardPeriods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="button button--primary" onClick={onCreateTask} disabled={workspace.projects.length === 0}>
            <Plus size={17} /> Create task
          </button>
        </div>
      </section>

      {import.meta.env.DEV && <section className="preview-control" aria-label="Prototype controls">
        <div>
          <CircleDot size={16} aria-hidden="true" />
          <span>Preview state</span>
        </div>
        <div className="preview-tabs" role="group" aria-label="Dashboard preview state">
          {viewOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              className={view === option.id ? 'is-active' : ''}
              aria-pressed={view === option.id}
              onClick={() => onViewChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>}

      {view === 'overview' && (
        <motion.div className="dashboard-overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <section className="metrics-grid" aria-label="Workspace metrics">
            <MetricCard
              label="Active projects"
              value={snapshot.activeProjects}
              helper="All currently on track"
              icon={<FolderKanban size={20} />}
              testId="active-projects-value"
            />
            <MetricCard
              label="Tasks completed"
              value={`${snapshot.completedTasks} / ${snapshot.totalTasks}`}
              helper={`${snapshot.completionRate}% completion rate`}
              icon={<CheckCircle2 size={20} />}
              tone="green"
              testId="tasks-completed-value"
            />
            <MetricCard
              label="Due this week"
              value={snapshot.dueThisWeek}
              helper="Across active tasks"
              icon={<CalendarClock size={20} />}
              tone="blue"
              testId="due-this-week-value"
            />
            <MetricCard
              label="Overdue tasks"
              value={snapshot.overdueTasks}
              helper="Needs attention"
              icon={<AlertTriangle size={20} />}
              tone="danger"
              testId="overdue-tasks-value"
            />
          </section>

          <div className="dashboard-grid dashboard-grid--top">
            <ActiveProjects workspace={workspace} onOpenProjects={onOpenProjects} onOpenProject={onOpenProject} />
            <CompletionChart workspace={workspace} period={period} />
          </div>

          <div className="dashboard-grid dashboard-grid--bottom">
            <UpcomingTasks
              workspace={workspace}
              completedTaskIds={completedTaskIds}
              onToggleTask={onToggleTask}
              onOpenTasks={onOpenTasks}
              onOpenTask={onOpenTask}
            />
            <RecentActivity workspace={workspace} onUnavailable={onUnavailable} />
          </div>
        </motion.div>
      )}
      {view === 'empty' && <EmptyDashboard onCreateProject={onCreateProject} onUnavailable={onUnavailable} />}
      {view === 'loading' && <LoadingDashboard />}
      {view === 'error' && <ErrorDashboard onRetry={onRetry} />}
    </div>
  )
}
