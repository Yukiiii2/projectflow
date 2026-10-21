import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, Mail, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'
import { useWorkspaces } from '../workspaces/WorkspaceContext'
import * as collaborationApi from './api'
import type { InvitationPreview } from './api'

export function InvitationAcceptPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { reload } = useWorkspaces()
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'accepting' | 'accepted'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    collaborationApi.getInvitation(token).then((result) => { if (current) { setInvitation(result); setStatus('ready') } }).catch((caught) => { if (current) { setError(caught instanceof Error ? caught.message : 'Invitation could not be loaded.'); setStatus('error') } })
    return () => { current = false }
  }, [token])

  const accept = async () => {
    setStatus('accepting'); setError('')
    try {
      const workspace = await collaborationApi.acceptInvitation(token)
      if (user) window.localStorage.setItem(`projectflow-workspace:${user.id}`, workspace.id)
      await reload(); setStatus('accepted'); window.setTimeout(() => navigate('/', { replace: true }), 700)
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Invitation could not be accepted.'); setStatus('ready') }
  }

  const stateMessage = invitation?.status === 'expired' ? 'This invitation has expired. Ask a workspace owner or admin for a new one.' : invitation?.status === 'revoked' ? 'This invitation was revoked and can no longer be accepted.' : invitation?.status === 'accepted' ? 'This invitation has already been accepted.' : ''

  return <div className="invitation-page"><header className="invitation-page__header"><Brand /></header><main className="invitation-card">
    {status === 'loading' && <div className="invitation-state" aria-busy="true"><LoaderCircle className="spin" size={25} /><h1>Checking invitation</h1><p>Confirming the workspace and invitation status.</p></div>}
    {status === 'error' && <div className="invitation-state" role="alert"><AlertTriangle size={28} /><h1>Invitation unavailable</h1><p>{error}</p><Link className="button button--secondary" to="/">Return to ProjectFlow</Link></div>}
    {invitation && status !== 'loading' && status !== 'error' && status !== 'accepted' && <>
      <span className="invitation-card__icon"><UsersRound size={26} /></span><span className="eyebrow">Workspace invitation</span><h1>{invitation.workspace_name}</h1><p><strong>{invitation.invited_by_name}</strong> invited <strong>{invitation.email}</strong> to join as {invitation.role === 'admin' ? 'an admin' : 'a member'}.</p>
      <div className="invitation-details"><span><Mail size={16} /> Signed in as {user?.email}</span><span><Clock3 size={16} /> Expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(invitation.expires_at))}</span></div>
      {(stateMessage || error) && <div className="form-alert" role="alert">{error || stateMessage}</div>}
      {invitation.status === 'pending' && <button type="button" className="button button--primary invitation-accept" disabled={status === 'accepting'} onClick={() => void accept()}>{status === 'accepting' && <LoaderCircle className="spin" size={17} />}{status === 'accepting' ? 'Joining workspace…' : 'Accept invitation'}</button>}
      <Link to="/" className="text-button">Return to ProjectFlow</Link>
    </>}
    {status === 'accepted' && <div className="invitation-state" role="status"><CheckCircle2 size={30} /><h1>Welcome to the workspace</h1><p>Your membership is active. Opening ProjectFlow now.</p></div>}
  </main></div>
}
