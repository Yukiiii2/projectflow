import { AlertCircle, Check, Eye, EyeOff, LoaderCircle, Moon, PlayCircle, Sun, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { ApiError } from './api'
import { useAuth } from './AuthContext'

type AuthMode = 'login' | 'register'
type FieldName = 'name' | 'email' | 'password' | 'confirmPassword'
type FieldErrors = Partial<Record<FieldName, string>>

interface AuthPageProps {
  mode: AuthMode
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

interface FieldProps {
  id: FieldName
  label: string
  type?: string
  value: string
  autoComplete: string
  error?: string
  hint?: string
  children?: ReactNode
  onChange: (value: string) => void
  onBlur: () => void
}

function Field({ id, label, type = 'text', value, autoComplete, error, hint, children, onChange, onBlur }: FieldProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input-wrap ${error ? 'is-invalid' : ''}`}>
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {children}
      </div>
      {error ? <p className="auth-field__error" id={`${id}-error`}>{error}</p> : hint ? <p className="auth-field__hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  )
}

function validateField(mode: AuthMode, field: FieldName, values: Record<FieldName, string>) {
  const value = values[field]
  if (field === 'name' && mode === 'register') {
    if (!value.trim()) return 'Enter your full name.'
    if (value.trim().length > 80) return 'Keep your name under 80 characters.'
  }
  if (field === 'email') {
    if (!value.trim()) return 'Enter your email address.'
    if (value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Enter a valid email address.'
  }
  if (field === 'password') {
    if (!value) return 'Enter your password.'
    if (value.length > 128) return 'Keep your password under 128 characters.'
    if (mode === 'register' && value.length < 12) return 'Use at least 12 characters.'
  }
  if (field === 'confirmPassword' && mode === 'register') {
    if (!value) return 'Confirm your password.'
    if (value !== values.password) return 'Passwords do not match.'
  }
  return ''
}

function WorkPreview() {
  const projects = [
    { name: 'Website redesign', meta: '36 of 48 tasks', progress: 75, tone: 'purple' },
    { name: 'Mobile app release', meta: '28 of 36 tasks', progress: 78, tone: 'blue' },
    { name: 'Brand refresh', meta: '24 of 32 tasks', progress: 75, tone: 'green' },
  ]
  return (
    <div className="auth-preview" aria-label="Project progress preview">
      <div className="auth-preview__header">
        <div>
          <span>Northstar Studio</span>
          <strong>Work in motion</strong>
        </div>
        <span className="auth-preview__status"><span aria-hidden="true" /> On track</span>
      </div>
      <div className="auth-preview__projects">
        {projects.map((project) => (
          <div className="auth-preview__project" key={project.name}>
            <div>
              <strong>{project.name}</strong>
              <span>{project.meta}</span>
            </div>
            <span className="auth-preview__percent">{project.progress}%</span>
            <div className="auth-preview__track" aria-hidden="true">
              <span className={`is-${project.tone}`} style={{ width: `${project.progress}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="auth-preview__footer">
        <span><Check size={15} aria-hidden="true" /> 96 tasks completed</span>
        <span>8 due this week</span>
      </div>
    </div>
  )
}

export function AuthPage({ mode, theme, onToggleTheme }: AuthPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, createAccount, enterDemo, notice, clearNotice, retrySession, availability } = useAuth()
  const [values, setValues] = useState<Record<FieldName, string>>({ name: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [demoSubmitting, setDemoSubmitting] = useState(false)
  const isRegister = mode === 'register'
  const registrationUnavailable = isRegister && !availability.registrationAvailable
  const state = location.state as { from?: string } | null
  const routeMessage = (location.state as { message?: string } | null)?.message ?? ''
  const destination = state?.from?.startsWith('/') ? state.from : '/'

  const update = (field: FieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const validateOne = (field: FieldName) => {
    const error = validateField(mode, field, values)
    setErrors((current) => ({ ...current, [field]: error || undefined }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields: FieldName[] = isRegister ? ['name', 'email', 'password', 'confirmPassword'] : ['email', 'password']
    const nextErrors = Object.fromEntries(fields.map((field) => [field, validateField(mode, field, values)]).filter(([, error]) => error)) as FieldErrors
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSubmitting(true)
    setFormError('')
    try {
      if (isRegister) await createAccount(values.name.trim(), values.email.trim(), values.password)
      else await login(values.email.trim(), values.password)
      navigate(destination, { replace: true })
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'ProjectFlow could not complete the request. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const tryDemo = async () => {
    if (!availability.demoAvailable) return
    setDemoSubmitting(true)
    setFormError('')
    try {
      await enterDemo()
      navigate(destination, { replace: true })
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'ProjectFlow could not start the demo. Try again.')
    } finally {
      setDemoSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <button
          type="button"
          className="icon-button auth-theme-button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>

      <main className="auth-layout">
        <section className="auth-story" aria-labelledby="auth-story-title">
          <div className="auth-story__copy">
            <h1 id="auth-story-title">A clear view of work in motion.</h1>
            <p>Bring project health, upcoming work, and team progress into one calm command center.</p>
          </div>
          <WorkPreview />
        </section>

        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-panel__heading">
            <h2 id="auth-title">{registrationUnavailable ? 'Registration unavailable' : isRegister ? 'Create your account' : 'Welcome back'}</h2>
            <p>{registrationUnavailable ? 'ProjectFlow is currently available through its private live demo.' : isRegister ? 'Start with your details. You can create a workspace next.' : 'Sign in to continue to your ProjectFlow workspace.'}</p>
          </div>

          {availability.portfolioMode && <div className="auth-alert" role="status"><AlertCircle size={18} aria-hidden="true" /><span>{registrationUnavailable ? 'New accounts are unavailable in portfolio mode. Use the private live demo instead.' : 'ProjectFlow is running in portfolio mode. New accounts and email-based recovery are unavailable; use the private live demo.'}</span></div>}

          {(notice || formError || routeMessage) && (
            <div className={`auth-alert ${routeMessage && !formError && !notice ? 'is-success' : ''}`} role="alert">
              {routeMessage && !formError && !notice ? <Check size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
              <span>{formError || notice || routeMessage}</span>
              {notice.includes('reach') && <button type="button" onClick={() => void retrySession()}>Retry</button>}
              {notice && !formError && (
                <button type="button" className="auth-alert__dismiss" aria-label="Dismiss message" onClick={clearNotice}>
                  <X size={16} />
                </button>
              )}
            </div>
          )}

          {!registrationUnavailable && <form className="auth-form" noValidate onSubmit={submit}>
            {isRegister && (
              <Field
                id="name"
                label="Full name"
                value={values.name}
                autoComplete="name"
                error={errors.name}
                onChange={(value) => update('name', value)}
                onBlur={() => validateOne('name')}
              />
            )}
            <Field
              id="email"
              label="Email address"
              type="email"
              value={values.email}
              autoComplete="email"
              error={errors.email}
              onChange={(value) => update('email', value)}
              onBlur={() => validateOne('email')}
            />
            {!isRegister && availability.passwordRecoveryAvailable && <Link className="auth-forgot-link" to="/forgot-password">Forgot password?</Link>}
            <Field
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={values.password}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              error={errors.password}
              hint={isRegister ? 'Use 12–128 characters.' : undefined}
              onChange={(value) => update('password', value)}
              onBlur={() => validateOne('password')}
            >
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </Field>
            {isRegister && (
              <Field
                id="confirmPassword"
                label="Confirm password"
                type={showPassword ? 'text' : 'password'}
                value={values.confirmPassword}
                autoComplete="new-password"
                error={errors.confirmPassword}
                onChange={(value) => update('confirmPassword', value)}
                onBlur={() => validateOne('confirmPassword')}
              />
            )}

            <button type="submit" className="button button--primary auth-submit" disabled={submitting || demoSubmitting}>
              {submitting && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
              {submitting ? (isRegister ? 'Creating account…' : 'Signing in…') : (isRegister ? 'Create account' : 'Sign in')}
            </button>
          </form>}

          {!isRegister && <div className="auth-demo">
            <div className="auth-demo__divider"><span>or explore without an account</span></div>
            <button type="button" className="button button--secondary auth-demo__button" disabled={submitting || demoSubmitting || !availability.demoAvailable} onClick={() => void tryDemo()}>
              {demoSubmitting ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <PlayCircle size={18} aria-hidden="true" />}
              {demoSubmitting ? 'Preparing your demo…' : availability.demoAvailable ? 'Try Demo' : 'Demo unavailable'}
            </button>
            <p>Your private demo workspace is writable and is cleared after 30 minutes.</p>
          </div>}

          {(isRegister || availability.registrationAvailable) && <p className="auth-switch">
            {isRegister ? 'Already have an account?' : 'New to ProjectFlow?'}{' '}
            <Link to={isRegister ? '/login' : '/register'} state={location.state}>{isRegister ? 'Sign in' : 'Create an account'}</Link>
          </p>}
        </section>
      </main>
    </div>
  )
}
