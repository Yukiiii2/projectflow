import { AlertTriangle, CalendarDays, CheckCircle2, Circle, Clock3, LoaderCircle, Plus, RotateCcw, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectTask, TaskStatus } from '../projects/api'
import { useProjects } from '../projects/ProjectsContext'
import { useWorkspaces } from '../workspaces/WorkspaceContext'

interface KanbanBoardProps {
  onCreateTask: () => void
  onEditTask: (task: ProjectTask) => void
}

interface ColumnDefinition {
  status: TaskStatus
  label: string
  description: string
  Icon: typeof Circle
}

type Recovery =
  | { kind: 'success'; taskId: string; title: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'error'; taskId: string; title: string; from: TaskStatus; to: TaskStatus; message: string }

const columns: ColumnDefinition[] = [
  { status: 'todo', label: 'To do', description: 'Ready to start', Icon: Circle },
  { status: 'in_progress', label: 'In progress', description: 'Currently moving', Icon: Clock3 },
  { status: 'done', label: 'Done', description: 'Completed work', Icon: CheckCircle2 },
]

function statusLabel(status: TaskStatus) {
  return columns.find((column) => column.status === status)?.label ?? status
}

function dateLabel(value: string | null) {
  if (!value) return 'No due date'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

function initials(name: string | null) {
  if (!name) return '?'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function KanbanSkeleton() {
  return <div className="kanban-board kanban-board--loading" aria-busy="true" aria-label="Loading Kanban board">
    {columns.map((column) => <section className="kanban-column" key={column.status}>
      <div className="kanban-column__header"><span className="skeleton skeleton--line" /></div>
      <div className="kanban-stack">{[0, 1].map((item) => <span className="kanban-card kanban-card--skeleton skeleton" key={item} />)}</div>
    </section>)}
  </div>
}

export function KanbanBoard({ onCreateTask, onEditTask }: KanbanBoardProps) {
  const { selectedWorkspace } = useWorkspaces()
  const { status, projects, tasks, error, reload, updateTask } = useProjects()
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('todo')
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)

  useEffect(() => {
    setRecovery(null)
    setDraggingId(null)
    setDropTarget(null)
    setMobileStatus('todo')
  }, [selectedWorkspace?.id])

  const grouped = useMemo(() => ({
    todo: tasks.filter((task) => task.status === 'todo'),
    in_progress: tasks.filter((task) => task.status === 'in_progress'),
    done: tasks.filter((task) => task.status === 'done'),
  }), [tasks])

  const markPending = (taskId: string, pending: boolean) => setPendingIds((current) => {
    const next = new Set(current)
    if (pending) next.add(taskId)
    else next.delete(taskId)
    return next
  })

  const moveTask = async (task: ProjectTask, nextStatus: TaskStatus) => {
    if (task.status === nextStatus || pendingIds.has(task.id)) return
    const from = task.status
    setRecovery(null)
    markPending(task.id, true)
    try {
      await updateTask(task.id, { status: nextStatus })
      setRecovery({ kind: 'success', taskId: task.id, title: task.title, from, to: nextStatus })
      setMobileStatus(nextStatus)
    } catch (caught) {
      setRecovery({
        kind: 'error', taskId: task.id, title: task.title, from, to: nextStatus,
        message: caught instanceof Error ? caught.message : 'The task update failed.',
      })
    } finally {
      markPending(task.id, false)
    }
  }

  const retryMove = async () => {
    if (!recovery || recovery.kind !== 'error') return
    const task = tasks.find((item) => item.id === recovery.taskId)
    if (task) await moveTask(task, recovery.to)
  }

  const undoMove = async () => {
    if (!recovery || recovery.kind !== 'success') return
    const current = tasks.find((task) => task.id === recovery.taskId)
    if (!current) return
    const previous = recovery
    markPending(current.id, true)
    try {
      await updateTask(current.id, { status: previous.from })
      setRecovery(null)
      setMobileStatus(previous.from)
    } catch (caught) {
      setRecovery({
        kind: 'error', taskId: current.id, title: current.title, from: current.status, to: previous.from,
        message: caught instanceof Error ? caught.message : 'The task could not be restored.',
      })
    } finally {
      markPending(current.id, false)
    }
  }

  const dropTask = (event: DragEvent<HTMLElement>, nextStatus: TaskStatus) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/plain') || draggingId
    const task = tasks.find((item) => item.id === taskId)
    setDraggingId(null)
    setDropTarget(null)
    if (task) void moveTask(task, nextStatus)
  }

  return <div className="management-page kanban-page">
    <header className="management-heading">
      <div>
        <span className="eyebrow">{selectedWorkspace?.name}</span>
        <h1 id="page-title">Kanban board</h1>
        <p>Move work through each stage while keeping project ownership, priority, and deadlines visible.</p>
      </div>
      <button type="button" className="button button--primary" disabled={!projects.length} onClick={onCreateTask}><Plus size={17} /> Create task</button>
    </header>

    {recovery?.kind === 'success' && <div className="kanban-recovery kanban-recovery--success" role="status">
      <CheckCircle2 size={18} aria-hidden="true" />
      <span><strong>{recovery.title}</strong> moved to {statusLabel(recovery.to)}.</span>
      <button type="button" onClick={() => void undoMove()} aria-label="Undo move"><RotateCcw size={15} /> Undo</button>
      <button type="button" className="kanban-recovery__dismiss" onClick={() => setRecovery(null)} aria-label="Dismiss update"><X size={16} /></button>
    </div>}
    {recovery?.kind === 'error' && <div className="kanban-recovery kanban-recovery--error" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span><strong>{recovery.title} could not be moved.</strong> Its original status was preserved. {recovery.message}</span>
      <button type="button" onClick={() => void retryMove()} aria-label="Retry move"><RotateCcw size={15} /> Retry</button>
      <button type="button" className="kanban-recovery__dismiss" onClick={() => setRecovery(null)} aria-label="Dismiss failed move"><X size={16} /></button>
    </div>}

    {(status === 'loading' || status === 'idle') && <KanbanSkeleton />}
    {status === 'error' && <section className="management-state" role="alert"><AlertTriangle size={25} /><strong>Kanban board could not be loaded</strong><span>{error}</span><button className="button button--secondary" type="button" onClick={() => void reload()}>Try again</button></section>}
    {status === 'ready' && projects.length === 0 && <section className="management-empty"><span className="management-empty__icon"><Circle size={26} /></span><h2>Create a project first</h2><p>Every task needs a project before it can appear on the board.</p><Link className="button button--primary" to="/projects">Open projects</Link></section>}
    {status === 'ready' && projects.length > 0 && tasks.length === 0 && <section className="management-empty"><span className="management-empty__icon"><CheckCircle2 size={26} /></span><h2>Your board is ready</h2><p>Create the first task to start moving work through the workflow.</p><button className="button button--primary" type="button" onClick={onCreateTask}><Plus size={17} /> Create task</button></section>}

    {status === 'ready' && tasks.length > 0 && <>
      <div className="kanban-mobile-tabs" role="tablist" aria-label="Kanban columns">
        {columns.map((column) => <button key={column.status} type="button" role="tab" aria-selected={mobileStatus === column.status} className={mobileStatus === column.status ? 'is-active' : ''} onClick={() => setMobileStatus(column.status)}>{column.label}<span>{grouped[column.status].length}</span></button>)}
      </div>
      <section className="kanban-board" aria-label="Task workflow">
        {columns.map(({ status: columnStatus, label, description, Icon }) => {
          const columnTasks = grouped[columnStatus]
          return <section
            className={`kanban-column ${mobileStatus === columnStatus ? 'is-mobile-current' : ''} ${dropTarget === columnStatus ? 'is-drop-target' : ''}`}
            data-testid={`kanban-column-${columnStatus}`}
            aria-label={`${label}, ${columnTasks.length} ${columnTasks.length === 1 ? 'task' : 'tasks'}`}
            key={columnStatus}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(columnStatus) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null) }}
            onDrop={(event) => dropTask(event, columnStatus)}
          >
            <header className="kanban-column__header"><span className={`kanban-column__icon kanban-column__icon--${columnStatus}`}><Icon size={17} /></span><span><strong>{label}</strong><small>{description}</small></span><b>{columnTasks.length}</b></header>
            <div className="kanban-stack">
              {columnTasks.map((task) => {
                const pending = pendingIds.has(task.id)
                return <article
                  className={`kanban-card ${draggingId === task.id ? 'is-dragging' : ''} ${pending ? 'is-pending' : ''}`}
                  data-testid={`kanban-task-${task.id}`}
                  draggable={!pending}
                  onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDraggingId(task.id) }}
                  onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                  key={task.id}
                >
                  <div className="kanban-card__topline"><span className={`priority priority--${task.priority}`}>{task.priority}</span><span className="kanban-card__project">{task.project_name}</span></div>
                  <button type="button" className="kanban-card__title" onClick={() => onEditTask(task)}>{task.title}</button>
                  {task.description && <p>{task.description}</p>}
                  <div className="kanban-card__meta">
                    <span className="kanban-assignee" title={task.assignee_name ?? 'Unassigned'}><span className="kanban-assignee__avatar" aria-hidden="true">{initials(task.assignee_name)}</span><span>{task.assignee_name ?? 'Unassigned'}</span></span>
                    <span className="kanban-due"><CalendarDays size={14} aria-hidden="true" /> {dateLabel(task.due_date)}</span>
                  </div>
                  <label className="kanban-move"><span><UserRound size={14} aria-hidden="true" /> Move task</span><select aria-label={`Move ${task.title}`} value={task.status} disabled={pending} onChange={(event) => void moveTask(task, event.target.value as TaskStatus)}>{columns.map((column) => <option value={column.status} key={column.status}>{column.label}</option>)}</select>{pending && <LoaderCircle className="spin" size={15} aria-label="Updating task" />}</label>
                </article>
              })}
              {columnTasks.length === 0 && <div className="kanban-column__empty"><Icon size={21} /><span>No tasks here</span><small>Move a task into this stage.</small></div>}
            </div>
          </section>
        })}
      </section>
    </>}
  </div>
}
