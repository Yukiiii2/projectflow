import { AlertCircle, ArrowLeft, Building2, Check, LoaderCircle, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useWorkspaces } from './WorkspaceContext'
import { workspaceInitials } from './dashboardFixture'

interface WorkspaceSetupProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  firstWorkspace?: boolean
}

export function WorkspaceSetup({ theme, onToggleTheme, firstWorkspace = false }: WorkspaceSetupProps) {
  const navigate = useNavigate()
  const { createWorkspace } = useWorkspaces()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const trimmedName = name.trim()
  const fieldError = touched && !trimmedName
    ? 'Enter a workspace name.'
    : touched && trimmedName.length > 120
      ? 'Use 120 characters or fewer.'
      : ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    setError('')
    if (!trimmedName || trimmedName.length > 120 || submitting) return
    setSubmitting(true)
    try {
      await createWorkspace(trimmedName)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ProjectFlow could not create this workspace.')
      setSubmitting(false)
    }
  }

  return (
    <div className="workspace-page">
      <header className="workspace-page__header">
        <Brand />
        <button
          type="button"
          className="icon-button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>

      <main className="workspace-page__main">
        <section className="workspace-setup-card" aria-labelledby="workspace-setup-title">
          {!firstWorkspace && (
            <Link className="workspace-back-link" to="/">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to dashboard
            </Link>
          )}
          <div className="workspace-setup-card__icon" aria-hidden="true"><Building2 size={25} /></div>
          <div className="workspace-setup-card__heading">
            <span className="eyebrow">Workspace setup</span>
            <h1 id="workspace-setup-title">{firstWorkspace ? 'Create your first workspace' : 'Create a workspace'}</h1>
            <p>{firstWorkspace
              ? 'Give your projects and teammates a shared home. You can add more workspaces later.'
              : 'Create a separate space for a client, team, or area of work.'}</p>
          </div>

          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form className="workspace-form" onSubmit={submit} noValidate>
            <div className="auth-field">
              <label htmlFor="workspace-name">Workspace name</label>
              <div className={`auth-input-wrap workspace-name-input ${fieldError ? 'is-invalid' : ''}`}>
                <span className="workspace-name-input__preview" aria-hidden="true">{workspaceInitials(trimmedName)}</span>
                <input
                  id="workspace-name"
                  name="workspace-name"
                  autoComplete="organization"
                  maxLength={121}
                  value={name}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? 'workspace-name-error' : 'workspace-name-hint'}
                  placeholder="e.g. Northstar Studio"
                  onBlur={() => setTouched(true)}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </div>
              {fieldError
                ? <span id="workspace-name-error" className="auth-field__error">{fieldError}</span>
                : <span id="workspace-name-hint" className="auth-field__hint">You will be the workspace owner.</span>}
            </div>

            <button type="submit" className="button button--primary workspace-submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
              {submitting ? 'Creating workspace…' : 'Create workspace'}
            </button>
          </form>

          <div className="workspace-setup-card__trust">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>Only workspace members can access this space.</span>
          </div>
        </section>
      </main>
    </div>
  )
}
