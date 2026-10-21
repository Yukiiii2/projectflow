import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../auth/api'
import { useAuth } from '../auth/AuthContext'
import * as workspaceApi from './api'
import type { WorkspaceSummary } from './api'

type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error'

interface WorkspaceContextValue {
  status: WorkspaceStatus
  workspaces: WorkspaceSummary[]
  selectedWorkspace: WorkspaceSummary | null
  error: string
  reload: () => Promise<void>
  selectWorkspace: (id: string) => boolean
  createWorkspace: (name: string) => Promise<WorkspaceSummary>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function storageKey(userId: string) {
  return `projectflow-workspace:${userId}`
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user, expireSession } = useAuth()
  const [status, setStatus] = useState<WorkspaceStatus>('idle')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    if (authStatus !== 'authenticated' || !user) return
    const currentRequest = ++requestId.current
    setStatus('loading')
    setError('')
    try {
      const loaded = await workspaceApi.loadWorkspaces()
      if (currentRequest !== requestId.current) return
      const savedId = window.localStorage.getItem(storageKey(user.id))
      const nextId = loaded.some((workspace) => workspace.id === savedId) ? savedId! : loaded[0]?.id ?? ''
      setWorkspaces(loaded)
      setSelectedId(nextId)
      if (nextId) window.localStorage.setItem(storageKey(user.id), nextId)
      else window.localStorage.removeItem(storageKey(user.id))
      setStatus('ready')
    } catch (caught) {
      if (currentRequest !== requestId.current) return
      if (caught instanceof ApiError && caught.status === 401) {
        expireSession()
        return
      }
      setError(caught instanceof Error ? caught.message : 'ProjectFlow could not load your workspaces.')
      setStatus('error')
    }
  }, [authStatus, expireSession, user])

  useEffect(() => {
    if (authStatus === 'authenticated' && user) {
      void reload()
      return
    }
    requestId.current += 1
    setStatus('idle')
    setWorkspaces([])
    setSelectedId('')
    setError('')
  }, [authStatus, reload, user])

  const selectWorkspace = useCallback((id: string) => {
    if (!user || !workspaces.some((workspace) => workspace.id === id)) return false
    setSelectedId(id)
    window.localStorage.setItem(storageKey(user.id), id)
    return true
  }, [user, workspaces])

  const createWorkspace = useCallback(async (name: string) => {
    if (!user) throw new ApiError(401, 'Your session has expired. Sign in again to continue.')
    try {
      const created = await workspaceApi.createWorkspace(name)
      setWorkspaces((current) => [created, ...current.filter((workspace) => workspace.id !== created.id)])
      setSelectedId(created.id)
      window.localStorage.setItem(storageKey(user.id), created.id)
      setStatus('ready')
      return created
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) expireSession()
      throw caught
    }
  }, [expireSession, user])

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedId) ?? null
  const value = useMemo<WorkspaceContextValue>(() => ({
    status,
    workspaces,
    selectedWorkspace,
    error,
    reload,
    selectWorkspace,
    createWorkspace,
  }), [createWorkspace, error, reload, selectWorkspace, selectedWorkspace, status, workspaces])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaces() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspaces must be used inside WorkspaceProvider')
  return context
}
