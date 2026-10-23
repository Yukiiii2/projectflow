import { AlertTriangle, Check, Copy, LoaderCircle, Mail, Plus, ShieldCheck, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useModalFocus } from '../components/useModalFocus'
import type { WorkspaceMember } from '../projects/api'
import { useProjects } from '../projects/ProjectsContext'
import { useWorkspaces } from '../workspaces/WorkspaceContext'
import * as collaborationApi from './api'
import type { WorkspaceInvitation } from './api'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function roleLabel(role: string) {
  return role[0]!.toUpperCase() + role.slice(1)
}

function InviteDialog({ workspaceId, actorRole, onClose, onCreated }: { workspaceId: string; actorRole: string; onClose: () => void; onCreated: (invitation: WorkspaceInvitation) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [delivery, setDelivery] = useState<{ status: 'preview' | 'queued' | 'sent'; preview_url?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  useModalFocus(dialogRef, onClose, submitting, emailRef)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!emailPattern.test(email.trim())) { setError('Enter a valid email address.'); return }
    setSubmitting(true); setError('')
    try {
      const result = await collaborationApi.createInvitation(workspaceId, email.trim(), role)
      onCreated(result.invitation); setDelivery(result.delivery)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invitation could not be created.') }
    finally { setSubmitting(false) }
  }

  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
    <section ref={dialogRef} className="dialog-card invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title">
      <header className="dialog-card__header"><div><h2 id="invite-dialog-title">Invite a teammate</h2><p>Create a secure, expiring workspace invitation.</p></div><button type="button" className="icon-button" aria-label="Close invite dialog" onClick={onClose}><X size={19} /></button></header>
      {delivery ? <div className="invite-result">
        <span className="invite-result__icon"><Check size={22} /></span>
        <h3>{delivery.status === 'sent' ? 'Invitation sent' : delivery.status === 'queued' ? 'Invitation queued' : 'Preview invitation ready'}</h3>
        <p>{delivery.status === 'sent' ? `The mail server accepted the invitation for ${email}.` : delivery.status === 'queued' ? `ProjectFlow queued secure delivery to ${email}.` : 'Development preview mode did not send email. Share this local link with the test recipient.'}</p>
        {delivery.preview_url && <label className="preview-link"><span>Acceptance link</span><span><input readOnly value={delivery.preview_url} /><button type="button" aria-label="Copy invitation link" onClick={() => void navigator.clipboard?.writeText(delivery.preview_url!).then(() => setCopied(true))}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></span></label>}
        <button className="button button--primary" type="button" onClick={onClose}>Done</button>
      </div> : <form className="management-form" noValidate onSubmit={(event) => void submit(event)}>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <label className="form-field"><span>Email address</span><input ref={emailRef} type="email" autoComplete="off" value={email} onChange={(event) => { setEmail(event.target.value); setError('') }} placeholder="teammate@example.com" /></label>
        <label className="form-field"><span>Workspace role</span><select aria-label="Workspace role" value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')}><option value="member">Member — collaborate on tasks</option>{actorRole === 'owner' && <option value="admin">Admin — manage projects and members</option>}</select></label>
        <div className="permission-note" role="note"><ShieldCheck size={17} /> Invitations expire after seven days and can be revoked before acceptance.</div>
        <footer className="dialog-card__actions"><button type="button" className="button button--secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={16} />} Create invitation</button></footer>
      </form>}
    </section>
  </div>
}

function MemberRow({ member, currentUserId, actorRole, busy, onRole, onRemove }: { member: WorkspaceMember; currentUserId: string; actorRole: string; busy: boolean; onRole: (role: 'admin' | 'member') => void; onRemove: () => void }) {
  const canChange = actorRole === 'owner' && member.role !== 'owner'
  const canRemove = member.id !== currentUserId && member.role !== 'owner' && (actorRole === 'owner' || actorRole === 'admin' && member.role === 'member')
  return <article className="team-member-row">
    <span className="team-avatar" aria-hidden="true">{initials(member.name)}</span>
    <span className="team-member-copy"><strong>{member.name}{member.id === currentUserId && <small> You</small>}</strong><span>{member.email}</span></span>
    <span className="team-member-joined">{member.joined_at ? `Joined ${dateLabel(member.joined_at)}` : 'Workspace member'}</span>
    {canChange ? <select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy} onChange={(event) => onRole(event.target.value as 'admin' | 'member')}><option value="member">Member</option><option value="admin">Admin</option></select> : <span className={`role-badge role-badge--${member.role}`}>{roleLabel(member.role)}</span>}
    {canRemove ? <button type="button" className="icon-button team-remove" aria-label={`Remove ${member.name}`} disabled={busy} onClick={onRemove}><Trash2 size={16} /></button> : <span className="team-row-spacer" />}
  </article>
}

export function TeamPage() {
  const { user } = useAuth()
  const { selectedWorkspace } = useWorkspaces()
  const { members, status: projectStatus, reload } = useProjects()
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const manager = selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin'

  useEffect(() => {
    if (!selectedWorkspace || !manager) { setInvitations([]); setInviteStatus('ready'); return }
    let current = true
    setInviteStatus('loading'); setInviteError('')
    collaborationApi.listInvitations(selectedWorkspace.id).then((items) => { if (current) { setInvitations(items); setInviteStatus('ready') } }).catch((caught) => { if (current) { setInviteError(caught instanceof Error ? caught.message : 'Invitations could not be loaded.'); setInviteStatus('error') } })
    return () => { current = false }
  }, [manager, selectedWorkspace])

  if (!selectedWorkspace || !user) return null
  const changeRole = async (member: WorkspaceMember, role: 'admin' | 'member') => {
    setBusyId(member.id); setNotice('')
    try { await collaborationApi.changeMemberRole(selectedWorkspace.id, member.id, role); await reload(); setNotice(`${member.name} is now ${role === 'admin' ? 'an' : 'a'} ${role}.`) }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The role could not be changed.') }
    finally { setBusyId('') }
  }
  const remove = async (member: WorkspaceMember) => {
    if (!window.confirm(`Remove ${member.name} from ${selectedWorkspace.name}?`)) return
    setBusyId(member.id); setNotice('')
    try { await collaborationApi.removeMember(selectedWorkspace.id, member.id); await reload(); setNotice(`${member.name} was removed from the workspace.`) }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The member could not be removed.') }
    finally { setBusyId('') }
  }
  const revoke = async (invitation: WorkspaceInvitation) => {
    setBusyId(invitation.id); setNotice('')
    try { const updated = await collaborationApi.revokeInvitation(selectedWorkspace.id, invitation.id); setInvitations((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice(`Invitation for ${invitation.email} was revoked.`) }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : 'The invitation could not be revoked.') }
    finally { setBusyId('') }
  }

  return <div className="management-page team-page">
    <header className="management-heading"><div><span className="eyebrow">{selectedWorkspace.name}</span><h1 id="page-title">Team</h1><p>Manage workspace access, roles, invitations, and the people available for task assignment.</p></div>{manager && <button type="button" className="button button--primary" onClick={() => setDialogOpen(true)}><Plus size={17} /> Invite member</button>}</header>
    {notice && <div className="team-notice" role="status">{notice}</div>}
    {!manager && <div className="permission-note" role="note"><ShieldCheck size={17} /> Owners and admins manage workspace invitations and membership.</div>}
    <section className="panel team-section" aria-labelledby="members-heading"><div className="panel-header"><div><h2 id="members-heading">Workspace members</h2><p>{members.length} {members.length === 1 ? 'person' : 'people'} can access this workspace</p></div><span className="team-count"><UsersRound size={16} /> {members.length}</span></div>
      {projectStatus === 'loading' || projectStatus === 'idle' ? <div className="team-loading" aria-busy="true"><LoaderCircle className="spin" size={21} /> Loading members</div> : <div className="team-member-list">{members.map((member) => <MemberRow key={member.id} member={member} currentUserId={user.id} actorRole={selectedWorkspace.role} busy={busyId === member.id} onRole={(role) => void changeRole(member, role)} onRemove={() => void remove(member)} />)}</div>}
    </section>
    {manager && <section className="panel team-section" aria-labelledby="invitations-heading"><div className="panel-header"><div><h2 id="invitations-heading">Invitations</h2><p>Track delivery and acceptance without exposing invitation tokens.</p></div><Mail size={19} /></div>
      {inviteStatus === 'loading' && <div className="team-loading" aria-busy="true"><LoaderCircle className="spin" size={21} /> Loading invitations</div>}
      {inviteStatus === 'error' && <div className="team-loading" role="alert"><AlertTriangle size={20} /> {inviteError}</div>}
      {inviteStatus === 'ready' && invitations.length === 0 && <div className="team-empty"><UserRound size={24} /><strong>No invitations yet</strong><span>Invite a teammate when you are ready to collaborate.</span></div>}
      {inviteStatus === 'ready' && invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => <article className="invitation-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>Invited by {invitation.invited_by_name} · Expires {dateLabel(invitation.expires_at)}</small></span><span className={`role-badge role-badge--${invitation.role}`}>{roleLabel(invitation.role)}</span><span className={`invitation-status invitation-status--${invitation.status}`}>{roleLabel(invitation.status)}</span>{invitation.status === 'pending' ? <button type="button" className="text-button" disabled={busyId === invitation.id} onClick={() => void revoke(invitation)}>Revoke</button> : <span />}</article>)}</div>}
    </section>}
    {dialogOpen && <InviteDialog workspaceId={selectedWorkspace.id} actorRole={selectedWorkspace.role} onClose={() => setDialogOpen(false)} onCreated={(created) => setInvitations((current) => [created, ...current])} />}
  </div>
}
