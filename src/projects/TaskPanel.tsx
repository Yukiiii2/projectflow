import { LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TaskActivityFeed, TaskComments } from '../collaboration/TaskCollaboration'
import { useModalFocus } from '../components/useModalFocus'
import type { ProjectSummary, ProjectTask, TaskInput, TaskPriority, TaskStatus, WorkspaceMember } from './api'

interface TaskPanelProps {
  task?: ProjectTask
  projectId?: string
  projects: ProjectSummary[]
  members: WorkspaceMember[]
  onClose: () => void
  onSubmit: (projectId: string, input: TaskInput) => Promise<void>
}

export function TaskPanel({ task, projectId, projects, members, onClose, onSubmit }: TaskPanelProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(task?.project_id ?? projectId ?? projects[0]?.id ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'activity'>('details')
  const titleRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const heading = task ? 'Edit task' : 'Create task'
  useModalFocus(panelRef, onClose, saving, titleRef)

  useEffect(() => {
    if (activeTab === 'details') titleRef.current?.focus()
  }, [activeTab])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (title.trim().length < 2) return setError('Enter a task title with at least 2 characters.')
    if (!selectedProjectId) return setError('Choose a project for this task.')
    setSaving(true)
    setError('')
    try {
      await onSubmit(selectedProjectId, { title: title.trim(), description: description.trim(), status, priority, dueDate: dueDate || null, assigneeId: assigneeId || null })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ProjectFlow could not save this task.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-layer dialog-layer--panel" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section ref={panelRef} className="side-panel side-panel--task" role="dialog" aria-modal="true" aria-labelledby="task-panel-title">
        <header className="dialog-card__header"><div><h2 id="task-panel-title">{heading}</h2><p>{task ? 'Keep task details and ownership current.' : 'Add the next clear piece of work.'}</p></div><button type="button" className="icon-button" aria-label={`Close ${heading.toLowerCase()}`} onClick={onClose}><X size={19} /></button></header>
        {task && <div className="task-panel-tabs" role="tablist" aria-label="Task panel sections">{(['details', 'comments', 'activity'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`task-${tab}-panel`} className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}</div>}
        {activeTab === 'details' && <form id="task-details-panel" role={task ? 'tabpanel' : undefined} className="management-form side-panel__form" onSubmit={(event) => void submit(event)}>
          {error && <div className="form-alert" role="alert">{error}</div>}
          {!projectId && !task && <label className="form-field"><span>Project</span><select aria-label="Project" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          <label className="form-field"><span>Task title</span><input ref={titleRef} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="form-field"><span>Description</span><textarea value={description} maxLength={2000} rows={5} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="form-grid">
            <label className="form-field"><span>Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label>
            <label className="form-field"><span>Priority</span><select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          </div>
          <div className="form-grid">
            <label className="form-field"><span>Due date</span><input aria-label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label className="form-field"><span>Assignee</span><select aria-label="Assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
          </div>
          <footer className="dialog-card__actions side-panel__actions"><button type="button" className="button button--secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving && <LoaderCircle className="spin" size={16} />}{task ? 'Save changes' : 'Create task'}</button></footer>
        </form>}
        {task && activeTab === 'comments' && <div id="task-comments-panel" role="tabpanel" className="side-panel__collaboration"><TaskComments taskId={task.id} /></div>}
        {task && activeTab === 'activity' && <div id="task-activity-panel" role="tabpanel" className="side-panel__collaboration"><TaskActivityFeed taskId={task.id} /></div>}
      </section>
    </div>
  )
}
