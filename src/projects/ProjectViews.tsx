import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, FolderKanban, LoaderCircle, Pencil, Plus, Search, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces } from '../workspaces/WorkspaceContext'
import type { ProjectSummary, ProjectTask, TaskStatus } from './api'
import { ProjectDialog } from './ProjectDialog'
import { useProjects } from './ProjectsContext'
import { TaskPanel } from './TaskPanel'

function progressFor(project: ProjectSummary) {
  return project.task_count ? Math.round(project.completed_task_count / project.task_count * 100) : 0
}

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : 'No due date'
}

function statusLabel(status: TaskStatus) {
  return status === 'in_progress' ? 'In progress' : status === 'done' ? 'Done' : 'To do'
}

function PageState({ status, error, onRetry }: { status: string; error: string; onRetry: () => void }) {
  if (status === 'loading' || status === 'idle') return <div className="management-state" aria-busy="true"><LoaderCircle className="spin" size={24} /><strong>Loading workspace data</strong><span>Projects and tasks are being synchronized.</span></div>
  if (status === 'error') return <div className="management-state" role="alert"><AlertTriangle size={25} /><strong>Workspace data could not be loaded</strong><span>{error}</span><button className="button button--secondary" type="button" onClick={onRetry}>Try again</button></div>
  return null
}

export function ProjectsPage() {
  const { selectedWorkspace } = useWorkspaces()
  const { status, projects, error, canManageProjects, reload, createProject } = useProjects()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const filtered = projects.filter((project) => `${project.name} ${project.description}`.toLowerCase().includes(query.trim().toLowerCase()))

  return <div className="management-page">
    <header className="management-heading"><div><span className="eyebrow">{selectedWorkspace?.name}</span><h1 id="page-title">Projects</h1><p>Plan outcomes, track progress, and keep workspace priorities visible.</p></div>{canManageProjects && projects.length > 0 && <button type="button" className="button button--primary" onClick={() => setDialogOpen(true)}><Plus size={17} /> Create project</button>}</header>
    {!canManageProjects && <div className="permission-note" role="note">Only workspace owners and admins can create or edit projects.</div>}
    <div className="management-toolbar"><label className="management-search"><Search size={17} /><span className="sr-only">Search projects</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label><span>{filtered.length} active {filtered.length === 1 ? 'project' : 'projects'}</span></div>
    <PageState status={status} error={error} onRetry={() => void reload()} />
    {status === 'ready' && projects.length === 0 && <section className="management-empty"><span className="management-empty__icon"><FolderKanban size={26} /></span><h2>No active projects yet</h2><p>Create a project to give tasks a clear goal and shared home.</p>{canManageProjects && <button className="button button--primary" type="button" onClick={() => setDialogOpen(true)}><Plus size={17} /> Create project</button>}</section>}
    {status === 'ready' && projects.length > 0 && filtered.length === 0 && <section className="management-empty"><h2>No matching projects</h2><p>Try a shorter project name or clear the search.</p></section>}
    {status === 'ready' && filtered.length > 0 && <section className="project-catalog" aria-label="Active projects">{filtered.map((project) => { const progress = progressFor(project); return <Link className="project-catalog__row" to={`/projects/${project.id}`} key={project.id} aria-label={`Open ${project.name} project`}><span className="project-catalog__icon"><FolderKanban size={19} /></span><span className="project-catalog__copy"><strong>{project.name}</strong><span>{project.description || 'No project description yet.'}</span></span><span className="project-catalog__progress"><span><b>{progress}%</b><small>{project.completed_task_count} of {project.task_count} tasks</small></span><span className="progress-track"><span style={{ width: `${progress}%` }} /></span></span><span className="project-catalog__due"><CalendarDays size={15} /> {dateLabel(project.next_due_date)}</span></Link> })}</section>}
    {dialogOpen && <ProjectDialog onClose={() => setDialogOpen(false)} onSubmit={async (input) => { await createProject(input) }} />}
  </div>
}

function TaskRow({ task, onEdit, onStatus }: { task: ProjectTask; onEdit: () => void; onStatus: (status: TaskStatus) => void }) {
  return <article className="management-task-row"><button className="management-task-row__main" type="button" onClick={onEdit}><span className={`task-status-dot task-status-dot--${task.status}`} /><span><strong>{task.title}</strong><small>{task.description || task.project_name}</small></span></button><span className={`priority priority--${task.priority}`}>{task.priority}</span><span className="task-assignee"><UserRound size={14} />{task.assignee_name ?? 'Unassigned'}</span><span className="task-due"><CalendarDays size={14} />{dateLabel(task.due_date)}</span><label className="status-select"><span className="sr-only">Status for {task.title}</span><select aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => onStatus(event.target.value as TaskStatus)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label></article>
}

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { status, projects, tasks, members, error, canManageProjects, reload, updateProject, archiveProject, createTask, updateTask } = useProjects()
  const [projectDialog, setProjectDialog] = useState(false)
  const [taskPanel, setTaskPanel] = useState<ProjectTask | 'create' | null>(null)
  const [actionError, setActionError] = useState('')
  const project = projects.find((item) => item.id === projectId)
  const projectTasks = tasks.filter((task) => task.project_id === projectId)

  if (status !== 'ready') return <div className="management-page"><PageState status={status} error={error} onRetry={() => void reload()} /></div>
  if (!project) return <div className="management-page"><section className="management-empty" role="alert"><AlertTriangle size={26} /><h1>Project unavailable</h1><p>This project is archived or is outside the selected workspace.</p><Link to="/projects" className="button button--secondary">Return to projects</Link></section></div>
  const progress = progressFor(project)

  return <div className="management-page">
    <Link to="/projects" className="back-link"><ArrowLeft size={16} /> All projects</Link>
    <header className="management-heading project-detail-heading"><div><span className="eyebrow">Active project</span><h1 id="page-title">{project.name}</h1><p>{project.description || 'No project description yet.'}</p></div><div>{canManageProjects && <button type="button" className="button button--secondary" aria-label="Edit project" onClick={() => setProjectDialog(true)}><Pencil size={16} /> Edit project</button>}<button type="button" className="button button--primary" onClick={() => setTaskPanel('create')}><Plus size={17} /> Create task</button></div></header>
    {actionError && <div className="form-alert" role="alert">{actionError}</div>}
    <section className="project-summary-grid" aria-label="Project summary"><article><span>Progress</span><strong>{progress}%</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></article><article><span>Tasks completed</span><strong>{project.completed_task_count} / {project.task_count}</strong><small>{project.task_count - project.completed_task_count} remaining</small></article><article><span>Next due date</span><strong>{dateLabel(project.next_due_date)}</strong><small>Based on active tasks</small></article></section>
    <section className="panel management-task-panel"><div className="panel-header"><div><h2>Project tasks</h2><p>{projectTasks.length} tasks in this project</p></div></div>{projectTasks.length === 0 ? <div className="inline-empty"><CheckCircle2 size={23} /><strong>No tasks yet</strong><span>Create the first task to start tracking project progress.</span></div> : <div className="management-task-list">{projectTasks.map((task) => <TaskRow key={task.id} task={task} onEdit={() => setTaskPanel(task)} onStatus={(next) => void updateTask(task.id, { status: next }).catch((caught) => setActionError(caught instanceof Error ? caught.message : 'Task could not be updated.'))} />)}</div>}</section>
    {projectDialog && <ProjectDialog project={project} onClose={() => setProjectDialog(false)} onSubmit={async (input) => { await updateProject(project.id, input) }} onArchive={async () => { await archiveProject(project.id); navigate('/projects', { replace: true }) }} />}
    {taskPanel && <TaskPanel task={taskPanel === 'create' ? undefined : taskPanel} projectId={project.id} projects={projects} members={members} onClose={() => setTaskPanel(null)} onSubmit={async (_target, input) => { if (taskPanel === 'create') await createTask(project.id, input); else await updateTask(taskPanel.id, input) }} />}
  </div>
}

export function TasksPage({ onCreateTask }: { onCreateTask: () => void }) {
  const { status, tasks, projects, members, error, reload, createTask, updateTask } = useProjects()
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')
  const [editing, setEditing] = useState<ProjectTask | null>(null)
  const visible = useMemo(() => filter === 'all' ? tasks : tasks.filter((task) => task.status === filter), [filter, tasks])
  return <div className="management-page"><header className="management-heading"><div><span className="eyebrow">Selected workspace</span><h1 id="page-title">My tasks</h1><p>Review and update work across every active project.</p></div><button type="button" className="button button--primary" disabled={!projects.length} onClick={onCreateTask}><Plus size={17} /> Create task</button></header><div className="management-toolbar"><div className="filter-tabs" role="group" aria-label="Task status filter">{(['all','todo','in_progress','done'] as const).map((value) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : statusLabel(value)}</button>)}</div><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span></div><PageState status={status} error={error} onRetry={() => void reload()} />{status === 'ready' && visible.length === 0 && <section className="management-empty"><CheckCircle2 size={28} /><h2>{tasks.length ? 'No tasks in this status' : 'No tasks yet'}</h2><p>{projects.length ? 'Create a task or choose another status filter.' : 'Create a project before adding tasks.'}</p></section>}{status === 'ready' && visible.length > 0 && <section className="panel management-task-panel"><div className="management-task-list">{visible.map((task) => <TaskRow key={task.id} task={task} onEdit={() => setEditing(task)} onStatus={(next) => void updateTask(task.id, { status: next })} />)}</div></section>}{editing && <TaskPanel task={editing} projects={projects} members={members} onClose={() => setEditing(null)} onSubmit={async (_projectId, input) => { await updateTask(editing.id, input) }} />}</div>
}
