import { Activity, AlertTriangle, Check, Clock3, LoaderCircle, MessageSquare, Pencil, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import * as collaborationApi from './api'
import type { TaskActivity, TaskComment } from './api'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function activityLabel(item: TaskActivity) {
  if (item.action === 'task.created') return 'created this task'
  if (item.action === 'comment.created') return 'added a comment'
  if (item.action === 'comment.edited') return 'edited a comment'
  if (item.action === 'comment.deleted') return 'deleted a comment'
  if (item.action === 'task.updated') {
    const fields = Array.isArray(item.metadata.fields) ? item.metadata.fields.map(String) : []
    if (fields.includes('status') && typeof item.metadata.status === 'string') return `moved this task to ${item.metadata.status.replace('_', ' ')}`
    if (fields.includes('assigneeId')) return 'changed the task assignee'
    return 'updated this task'
  }
  return item.action.replaceAll('.', ' ')
}

function CommentItem({ comment, busy, onUpdated, onDeleted }: { comment: TaskComment; busy: boolean; onUpdated: (comment: TaskComment) => void; onDeleted: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [error, setError] = useState('')
  const save = async () => {
    if (!body.trim()) { setError('Comment cannot be empty.'); return }
    try { const updated = await collaborationApi.updateComment(comment.id, body.trim()); onUpdated(updated); setEditing(false); setError('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Comment could not be updated.') }
  }
  const remove = async () => {
    if (!window.confirm('Delete this comment?')) return
    try { await collaborationApi.deleteComment(comment.id); onDeleted(comment.id) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Comment could not be deleted.') }
  }
  return <article className="comment-item"><span className="comment-avatar" aria-hidden="true">{initials(comment.author_name)}</span><div className="comment-item__body"><header><strong>{comment.author_name}</strong><span>{timestamp(comment.created_at)}{comment.edited_at ? ' · Edited' : ''}</span></header>
    {editing ? <div className="comment-editor"><textarea aria-label="Edit comment" value={body} maxLength={5000} onChange={(event) => setBody(event.target.value)} />{error && <span className="field-error" role="alert">{error}</span>}<div><button type="button" className="text-button" onClick={() => { setEditing(false); setBody(comment.body); setError('') }}><X size={14} /> Cancel</button><button type="button" className="button button--primary button--small" onClick={() => void save()}><Check size={14} /> Save comment</button></div></div> : <><p>{comment.body}</p>{error && <span className="field-error" role="alert">{error}</span>}<div className="comment-actions">{comment.can_edit && <button type="button" aria-label="Edit comment" disabled={busy} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}{comment.can_delete && <button type="button" aria-label="Delete comment" disabled={busy} onClick={() => void remove()}><Trash2 size={14} /> Delete</button>}</div></>}
  </div></article>
}

export function TaskComments({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const load = () => { setStatus('loading'); collaborationApi.listComments(taskId).then((items) => { setComments(items); setStatus('ready') }).catch((caught) => { setError(caught instanceof Error ? caught.message : 'Comments could not be loaded.'); setStatus('error') }) }
  useEffect(load, [taskId])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim()) { setError('Write a comment before posting.'); return }
    setPosting(true); setError('')
    try { const created = await collaborationApi.createComment(taskId, body.trim()); setComments((current) => [...current, created]); setBody('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Comment could not be posted.') }
    finally { setPosting(false) }
  }
  return <section className="task-collaboration" aria-labelledby="task-comments-heading"><div className="task-collaboration__heading"><div><h3 id="task-comments-heading">Comments</h3><p>Keep decisions and context with the task.</p></div><span>{comments.length}</span></div>
    {status === 'loading' && <div className="collaboration-state" aria-busy="true"><LoaderCircle className="spin" size={20} /> Loading comments</div>}
    {status === 'error' && <div className="collaboration-state" role="alert"><AlertTriangle size={20} /><span>{error}</span><button type="button" className="text-button" onClick={load}>Retry</button></div>}
    {status === 'ready' && comments.length === 0 && <div className="collaboration-empty"><MessageSquare size={23} /><strong>No comments yet</strong><span>Start the conversation with a useful update.</span></div>}
    {status === 'ready' && comments.length > 0 && <div className="comment-list">{comments.map((comment) => <CommentItem key={comment.id} comment={comment} busy={posting} onUpdated={(updated) => setComments((current) => current.map((item) => item.id === updated.id ? updated : item))} onDeleted={(id) => setComments((current) => current.filter((item) => item.id !== id))} />)}</div>}
    {status === 'ready' && <form className="comment-compose" onSubmit={(event) => void submit(event)}><label htmlFor="new-task-comment">Add a comment</label><textarea id="new-task-comment" value={body} maxLength={5000} rows={3} placeholder="Share an update or decision…" onChange={(event) => { setBody(event.target.value); setError('') }} />{error && <span className="field-error" role="alert">{error}</span>}<button type="submit" className="button button--primary button--small" disabled={posting}>{posting ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Post comment</button></form>}
  </section>
}

export function TaskActivityFeed({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<TaskActivity[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  useEffect(() => { collaborationApi.listTaskActivity(taskId).then((activityItems) => { setItems(activityItems); setStatus('ready') }).catch((caught) => { setError(caught instanceof Error ? caught.message : 'Activity could not be loaded.'); setStatus('error') }) }, [taskId])
  return <section className="task-collaboration" aria-labelledby="task-activity-heading"><div className="task-collaboration__heading"><div><h3 id="task-activity-heading">Activity</h3><p>Recent changes recorded for this task.</p></div><Activity size={18} /></div>
    {status === 'loading' && <div className="collaboration-state" aria-busy="true"><LoaderCircle className="spin" size={20} /> Loading activity</div>}
    {status === 'error' && <div className="collaboration-state" role="alert"><AlertTriangle size={20} /> {error}</div>}
    {status === 'ready' && items.length === 0 && <div className="collaboration-empty"><Clock3 size={23} /><strong>No activity yet</strong><span>Task and comment updates will appear here.</span></div>}
    {status === 'ready' && items.length > 0 && <div className="activity-timeline">{items.map((item) => <article key={item.id}><span className="activity-timeline__dot" /><div><p><strong>{item.actor_name ?? 'Former member'}</strong> {activityLabel(item)}</p><time dateTime={item.created_at}>{timestamp(item.created_at)}</time></div></article>)}</div>}
  </section>
}
