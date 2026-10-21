import { Archive, LoaderCircle, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useModalFocus } from '../components/useModalFocus'
import type { ProjectInput, ProjectSummary } from './api'

interface ProjectDialogProps {
  project?: ProjectSummary
  onClose: () => void
  onSubmit: (input: ProjectInput) => Promise<void>
  onArchive?: () => Promise<void>
}

export function ProjectDialog({ project, onClose, onSubmit, onArchive }: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const title = project ? 'Edit project' : 'Create project'
  useModalFocus(dialogRef, onClose, saving, nameRef)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      setError('Enter a project name with at least 2 characters.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({ name: trimmedName, description: description.trim() })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ProjectFlow could not save this project.')
    } finally {
      setSaving(false)
    }
  }

  const archive = async () => {
    if (!onArchive) return
    setSaving(true)
    setError('')
    try {
      await onArchive()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ProjectFlow could not archive this project.')
      setSaving(false)
    }
  }

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section ref={dialogRef} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <header className="dialog-card__header">
          <div><h2 id="project-dialog-title">{title}</h2><p>{project ? 'Update the shared project details.' : 'Add a focused project to this workspace.'}</p></div>
          <button type="button" className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="management-form" onSubmit={(event) => void submit(event)}>
          {error && <div className="form-alert" role="alert">{error}</div>}
          <label className="form-field"><span>Project name</span><input ref={nameRef} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>Description</span><textarea value={description} maxLength={1000} rows={4} onChange={(event) => setDescription(event.target.value)} placeholder="What outcome will this project deliver?" /></label>
          {project && onArchive && (
            <div className="archive-control">
              {confirmArchive ? (
                <div role="alert"><p>Archive this project and hide its tasks from the active workspace?</p><div><button type="button" className="button button--danger" disabled={saving} onClick={() => void archive()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />} Confirm archive</button><button type="button" className="button button--secondary" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</button></div></div>
              ) : <button type="button" className="text-button text-button--danger" onClick={() => setConfirmArchive(true)}><Archive size={15} /> Archive project</button>}
            </div>
          )}
          <footer className="dialog-card__actions"><button type="button" className="button button--secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving && <LoaderCircle className="spin" size={16} />}{project ? 'Save changes' : 'Create project'}</button></footer>
        </form>
      </section>
    </div>
  )
}
