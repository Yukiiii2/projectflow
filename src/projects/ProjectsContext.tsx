import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../auth/api'
import { useAuth } from '../auth/AuthContext'
import { useWorkspaces } from '../workspaces/WorkspaceContext'
import * as projectApi from './api'
import type { ProjectInput, ProjectSummary, ProjectTask, TaskInput, WorkspaceMember } from './api'

type ProjectStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ProjectsContextValue {
  status: ProjectStatus
  projects: ProjectSummary[]
  tasks: ProjectTask[]
  members: WorkspaceMember[]
  error: string
  canManageProjects: boolean
  reload: () => Promise<void>
  createProject: (input: ProjectInput) => Promise<ProjectSummary>
  updateProject: (projectId: string, input: Partial<ProjectInput>) => Promise<ProjectSummary>
  archiveProject: (projectId: string) => Promise<void>
  createTask: (projectId: string, input: TaskInput) => Promise<ProjectTask>
  updateTask: (taskId: string, input: Partial<TaskInput>) => Promise<ProjectTask>
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { expireSession } = useAuth()
  const { status: workspaceStatus, selectedWorkspace, reload: reloadWorkspaces } = useWorkspaces()
  const [status, setStatus] = useState<ProjectStatus>('idle')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const handleError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) {
      expireSession()
      return
    }
    if (caught instanceof ApiError && (caught.status === 403 || caught.status === 404)) {
      setError('You no longer have access to this workspace. Refresh your workspace list and try again.')
      void reloadWorkspaces()
      return
    }
    setError(caught instanceof Error ? caught.message : 'ProjectFlow could not load this workspace data.')
  }, [expireSession, reloadWorkspaces])

  const reload = useCallback(async () => {
    if (workspaceStatus !== 'ready' || !selectedWorkspace) return
    const currentRequest = ++requestId.current
    const workspaceId = selectedWorkspace.id
    setStatus('loading')
    setError('')
    try {
      const [loadedProjects, loadedTasks, loadedMembers] = await Promise.all([
        projectApi.listProjects(workspaceId),
        projectApi.listWorkspaceTasks(workspaceId),
        projectApi.listWorkspaceMembers(workspaceId),
      ])
      if (currentRequest !== requestId.current) return
      setProjects(loadedProjects)
      setTasks(loadedTasks)
      setMembers(loadedMembers)
      setStatus('ready')
    } catch (caught) {
      if (currentRequest !== requestId.current) return
      handleError(caught)
      setStatus('error')
    }
  }, [handleError, selectedWorkspace, workspaceStatus])

  useEffect(() => {
    if (workspaceStatus === 'ready' && selectedWorkspace) {
      setProjects([])
      setTasks([])
      setMembers([])
      void reload()
      return
    }
    requestId.current += 1
    setStatus('idle')
    setProjects([])
    setTasks([])
    setMembers([])
    setError('')
  }, [reload, selectedWorkspace, workspaceStatus])

  const requireWorkspace = () => {
    if (!selectedWorkspace) throw new ApiError(404, 'Choose a workspace before managing projects.')
    return selectedWorkspace
  }
  const requireProject = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) throw new ApiError(404, 'This project is not available in the selected workspace.')
    return project
  }

  const createProject = useCallback(async (input: ProjectInput) => {
    const workspace = requireWorkspace()
    const created = await projectApi.createProject(workspace.id, input)
    setProjects((current) => [created, ...current])
    return created
  }, [selectedWorkspace])

  const updateProject = useCallback(async (projectId: string, input: Partial<ProjectInput>) => {
    requireProject(projectId)
    const updated = await projectApi.updateProject(projectId, input)
    setProjects((current) => current.map((project) => project.id === projectId ? updated : project))
    setTasks((current) => current.map((task) => task.project_id === projectId ? { ...task, project_name: updated.name } : task))
    return updated
  }, [projects])

  const archiveProject = useCallback(async (projectId: string) => {
    requireProject(projectId)
    await projectApi.archiveProject(projectId)
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setTasks((current) => current.filter((task) => task.project_id !== projectId))
  }, [projects])

  const createTask = useCallback(async (projectId: string, input: TaskInput) => {
    requireProject(projectId)
    const created = await projectApi.createTask(projectId, input)
    setTasks((current) => [created, ...current])
    setProjects((current) => current.map((project) => project.id === projectId ? {
      ...project,
      task_count: project.task_count + 1,
      completed_task_count: project.completed_task_count + (created.status === 'done' ? 1 : 0),
      next_due_date: project.next_due_date ?? created.due_date,
    } : project))
    return created
  }, [projects])

  const updateTask = useCallback(async (taskId: string, input: Partial<TaskInput>) => {
    const previous = tasks.find((task) => task.id === taskId)
    if (!previous || !projects.some((project) => project.id === previous.project_id)) {
      throw new ApiError(404, 'This task is not available in the selected workspace.')
    }
    const updated = await projectApi.updateTask(taskId, input)
    setTasks((current) => current.map((task) => task.id === taskId ? updated : task))
    if (previous.status !== updated.status) {
      const delta = updated.status === 'done' ? 1 : previous.status === 'done' ? -1 : 0
      setProjects((current) => current.map((project) => project.id === updated.project_id ? {
        ...project,
        completed_task_count: Math.max(0, project.completed_task_count + delta),
      } : project))
    }
    return updated
  }, [projects, tasks])

  const value = useMemo<ProjectsContextValue>(() => ({
    status, projects, tasks, members, error,
    canManageProjects: selectedWorkspace?.role === 'owner' || selectedWorkspace?.role === 'admin',
    reload, createProject, updateProject, archiveProject, createTask, updateTask,
  }), [archiveProject, createProject, createTask, error, members, projects, reload, selectedWorkspace?.role, status, tasks, updateProject, updateTask])

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const context = useContext(ProjectsContext)
  if (!context) throw new Error('useProjects must be used inside ProjectsProvider')
  return context
}
