import { AlertCircle, CheckCircle2, LoaderCircle, Moon, Send, Sun } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { ApiError, confirmEmailVerification, confirmPasswordReset, requestEmailVerification, requestPasswordReset } from './api'
import { useAuth } from './AuthContext'

interface PageProps { theme: 'dark' | 'light'; onToggleTheme: () => void }

function Shell({ theme, onToggleTheme, title, description, children }: PageProps & { title: string; description: string; children: React.ReactNode }) {
  return <div className="auth-page">
    <header className="auth-header">
      <Brand />
      <button type="button" className="icon-button auth-theme-button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onToggleTheme}>
        {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
      </button>
    </header>
    <main className="auth-action-layout">
      <section className="auth-panel auth-action-panel" aria-labelledby="auth-action-title">
        <div className="auth-panel__heading">
          <h1 id="auth-action-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </main>
  </div>
}

function Alert({ message, success = false }: { message: string; success?: boolean }) {
  if (!message) return null
  return <div className={`auth-alert ${success ? 'is-success' : ''}`} role={success ? 'status' : 'alert'}>
    {success ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
    <span>{message}</span>
  </div>
}

export function ForgotPasswordPage(props: PageProps) {
  const { availability } = useAuth()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return }
    setSubmitting(true); setError('')
    try { setMessage((await requestPasswordReset(email.trim())).message) }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Could not request a reset link.') }
    finally { setSubmitting(false) }
  }
  if (!availability.passwordRecoveryAvailable) return <Shell {...props} title="Password recovery unavailable" description="Email-based password recovery is unavailable while ProjectFlow is running in portfolio mode.">
    <Alert message="Existing users can still sign in. Portfolio visitors can use the private live demo without an account." />
    <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
  </Shell>
  return <Shell {...props} title="Reset your password" description="Enter your account email. We’ll send a time-limited reset link if it matches an account.">
    <Alert message={error || message} success={Boolean(message && !error)} />
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field"><label htmlFor="recovery-email">Email address</label><div className="auth-input-wrap"><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div></div>
      <button className="button button--primary auth-submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{submitting ? 'Sending…' : 'Send reset link'}</button>
    </form>
    <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
  </Shell>
}

export function ResetPasswordPage(props: PageProps) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(token ? '' : 'This password reset link is incomplete.')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 12 || password.length > 128) { setError('Use 12–128 characters.'); return }
    if (password !== confirmation) { setError('Passwords do not match.'); return }
    setSubmitting(true); setError('')
    try {
      await confirmPasswordReset(token, password)
      navigate('/login', { replace: true, state: { message: 'Your password has been reset. Sign in with your new password.' } })
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Could not reset your password.') }
    finally { setSubmitting(false) }
  }
  return <Shell {...props} title="Choose a new password" description="Use a unique password with at least 12 characters.">
    <Alert message={error} />
    <form className="auth-form" noValidate onSubmit={submit}>
      <div className="auth-field"><label htmlFor="new-password">New password</label><div className="auth-input-wrap"><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></div>
      <div className="auth-field"><label htmlFor="confirm-new-password">Confirm new password</label><div className="auth-input-wrap"><input id="confirm-new-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></div>
      <button className="button button--primary auth-submit" disabled={submitting || !token}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? 'Resetting…' : 'Reset password'}</button>
    </form>
  </Shell>
}

export function VerifyEmailPage(props: PageProps) {
  const { status, user, refreshUser, availability } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  if (status === 'authenticated' && (user?.email_verified || !user?.email_verification_required)) return <Navigate to="/" replace />
  const act = async () => {
    setSubmitting(true); setError(''); setMessage('')
    try {
      if (token) {
        const response = await confirmEmailVerification(token)
        const refreshed = await refreshUser()
        if (refreshed) navigate('/', { replace: true })
        else navigate('/login', { replace: true, state: { message: response.message } })
      } else {
        setMessage((await requestEmailVerification()).message)
      }
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Could not complete email verification.') }
    finally { setSubmitting(false) }
  }
  const resendUnavailable = !token && !availability.verificationResendAvailable
  return <Shell {...props} title="Verify your email" description={token ? 'Confirm this address to finish securing your ProjectFlow account.' : resendUnavailable ? 'Verification email resend is unavailable in portfolio mode.' : `We sent a verification link to ${user?.email ?? 'your email address'}.`}>
    <Alert message={error || message || (resendUnavailable ? 'Use an existing verification link if you already received one.' : '')} success={Boolean(message && !error)} />
    {!resendUnavailable && <button className="button button--primary auth-submit" type="button" disabled={submitting || (!token && status !== 'authenticated')} onClick={() => void act()}>
      {submitting && <LoaderCircle className="spin" size={17} />}{submitting ? 'Working…' : token ? 'Verify email' : 'Resend verification email'}
    </button>}
    {status === 'unauthenticated' && !token && <p className="auth-switch"><Link to="/login">Sign in to request another link</Link></p>}
  </Shell>
}
