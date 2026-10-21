import { AnimatePresence, motion } from 'motion/react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AuthPage } from './auth/AuthPage'
import { ProtectedRoute, PublicOnlyRoute } from './auth/RouteGuards'
import { AppShell } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { InvitationAcceptPage } from './collaboration/InvitationAcceptPage'
import { TeamPage } from './collaboration/TeamPage'
import type { DashboardPeriod, DashboardView } from './domain/types'
import { KanbanBoard } from './kanban/KanbanBoard'
import type { ProjectTask } from './projects/api'
import { buildDashboardWorkspace } from './projects/dashboardData'
import { ProjectDialog } from './projects/ProjectDialog'
import { ProjectDetailPage, ProjectsPage, TasksPage } from './projects/ProjectViews'
import { ProjectsProvider, useProjects } from './projects/ProjectsContext'
import { TaskPanel } from './projects/TaskPanel'
import { WorkspaceProvider, useWorkspaces } from './workspaces/WorkspaceContext'
import { WorkspaceGate } from './workspaces/WorkspaceGate'
import { WorkspaceSetup } from './workspaces/WorkspaceSetup'

type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  return window.localStorage.getItem('projectflow-theme') === 'light' ? 'light' : 'dark'
}

function unavailableMessage(feature: string) {
  const messages: Record<string, string> = {
    'Global search': 'Advanced search is planned for ProjectFlow V1.1.',
    Notifications: 'Notifications are planned for ProjectFlow V1.1.',
    Calendar: 'Calendar is planned for ProjectFlow V1.1.',
    Team: 'Team invitations will be connected in the collaboration stage.',
    Settings: 'Workspace settings are planned for a later stage.',
    'Help and support': 'Help and support content is planned for a later stage.',
    'Profile settings': 'Profile settings are planned for a later stage.',
    'Account preferences': 'Account preferences are planned for a later stage.',
    'Template gallery': 'Project templates are outside the current Stage C scope.',
  }
  return messages[feature] ?? `${feature} is not available in this prototype stage.`
}

interface ApplicationActions {
  openCreateProject: () => void
  openCreateTask: () => void
  openTask: (task: ProjectTask) => void
  showNotice: (message: string) => void
}

const ApplicationActionsContext = createContext<ApplicationActions | null>(null)
function useApplicationActions() {
  const value = useContext(ApplicationActionsContext)
  if (!value) throw new Error('Application actions are unavailable.')
  return value
}

function ApplicationExperience({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { workspaces, selectedWorkspace, selectWorkspace } = useWorkspaces()
  const { projects, tasks, members, createProject, createTask, updateTask } = useProjects()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [taskPanel, setTaskPanel] = useState<ProjectTask | 'create' | null>(null)
  const [notice, setNotice] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const noticeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current) }, [])
  if (!user || !selectedWorkspace) return null
  const dashboardWorkspace = buildDashboardWorkspace(selectedWorkspace, projects, tasks, members, user)

  const showNotice = (message: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 4400)
  }
  const showUnavailable = (feature: string) => showNotice(unavailableMessage(feature))
  const changeWorkspace = (id: string) => {
    const next = workspaces.find((workspace) => workspace.id === id)
    if (!next || !selectWorkspace(id)) return
    setTaskPanel(null)
    setProjectDialogOpen(false)
    navigate('/')
    showNotice(`Switched to ${next.name}.`)
  }
  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await logout()
    navigate('/login', { replace: true })
  }
  const actions: ApplicationActions = {
    openCreateProject: () => setProjectDialogOpen(true),
    openCreateTask: () => projects.length ? setTaskPanel('create') : showNotice('Create a project before adding tasks.'),
    openTask: (task) => setTaskPanel(task),
    showNotice,
  }

  return <ApplicationActionsContext.Provider value={actions}>
    <a href="#page-title" className="skip-link">Skip to main content</a>
    <AppShell
      user={user} workspace={dashboardWorkspace} workspaceOptions={workspaces} workspaceRole={selectedWorkspace.role} workspaceId={selectedWorkspace.id}
      onWorkspaceChange={changeWorkspace} onCreateWorkspace={() => navigate('/workspaces/new')} theme={theme} onToggleTheme={onToggleTheme}
      sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} mobileDrawerOpen={mobileDrawerOpen}
      onMobileDrawerChange={setMobileDrawerOpen} onUnavailable={showUnavailable} onCreateTask={actions.openCreateTask}
      onSignOut={() => void handleSignOut()} signingOut={signingOut} currentPath={location.pathname} onRouteChange={navigate}
    >
      <Outlet />
    </AppShell>
    {projectDialogOpen && <ProjectDialog onClose={() => setProjectDialogOpen(false)} onSubmit={async (input) => { const created = await createProject(input); showNotice(`${created.name} was created.`) }} />}
    {taskPanel && <TaskPanel task={taskPanel === 'create' ? undefined : taskPanel} projects={projects} members={members} onClose={() => setTaskPanel(null)} onSubmit={async (projectId, input) => { if (taskPanel === 'create') { const created = await createTask(projectId, input); showNotice(`${created.title} was created.`) } else { const updated = await updateTask(taskPanel.id, input); showNotice(`${updated.title} was updated.`) } }} />}
    <AnimatePresence>{notice && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{notice}</motion.div>}</AnimatePresence>
  </ApplicationActionsContext.Provider>
}

function DashboardRoute() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { selectedWorkspace } = useWorkspaces()
  const { status, projects, tasks, members, reload, updateTask } = useProjects()
  const actions = useApplicationActions()
  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const [preview, setPreview] = useState<DashboardView>('overview')
  if (!user || !selectedWorkspace) return null
  const workspace = buildDashboardWorkspace(selectedWorkspace, projects, tasks, members, user)
  const view: DashboardView = status === 'loading' || status === 'idle' ? 'loading' : status === 'error' ? 'error' : projects.length === 0 && preview === 'overview' ? 'empty' : preview
  return <Dashboard
    workspace={workspace} userName={user.name} period={period} onPeriodChange={setPeriod} view={view} onViewChange={setPreview}
    completedTaskIds={[]} onToggleTask={(taskId) => { const task = tasks.find((item) => item.id === taskId); if (task) void updateTask(taskId, { status: task.status === 'done' ? 'todo' : 'done' }) }}
    onUnavailable={(feature) => actions.showNotice(unavailableMessage(feature))} onRetry={() => void reload()}
    onCreateProject={actions.openCreateProject} onCreateTask={actions.openCreateTask} onOpenProjects={() => navigate('/projects')}
    onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} onOpenTasks={() => navigate('/tasks')}
    onOpenTask={(taskId) => { const task = tasks.find((item) => item.id === taskId); if (task) actions.openTask(task) }}
  />
}

function TasksRoute() {
  const { openCreateTask } = useApplicationActions()
  return <TasksPage onCreateTask={openCreateTask} />
}

function KanbanRoute() {
  const { openCreateTask, openTask } = useApplicationActions()
  return <KanbanBoard onCreateTask={openCreateTask} onEditTask={openTask} />
}

function ProtectedApplication({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return <ProtectedRoute><WorkspaceGate theme={theme} onToggleTheme={onToggleTheme}><ProjectsProvider><ApplicationExperience theme={theme} onToggleTheme={onToggleTheme} /></ProjectsProvider></WorkspaceGate></ProtectedRoute>
}

export function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('projectflow-theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0B0E14' : '#F7F8FB')
  }, [theme])
  const toggleTheme = () => setTheme((value) => value === 'dark' ? 'light' : 'dark')

  return <BrowserRouter><AuthProvider><WorkspaceProvider><Routes>
    <Route path="/login" element={<PublicOnlyRoute><AuthPage key="login" mode="login" theme={theme} onToggleTheme={toggleTheme} /></PublicOnlyRoute>} />
    <Route path="/register" element={<PublicOnlyRoute><AuthPage key="register" mode="register" theme={theme} onToggleTheme={toggleTheme} /></PublicOnlyRoute>} />
    <Route path="/workspaces/new" element={<ProtectedRoute><WorkspaceGate theme={theme} onToggleTheme={toggleTheme}><WorkspaceSetup theme={theme} onToggleTheme={toggleTheme} /></WorkspaceGate></ProtectedRoute>} />
    <Route path="/invite/:token" element={<ProtectedRoute><InvitationAcceptPage /></ProtectedRoute>} />
    <Route element={<ProtectedApplication theme={theme} onToggleTheme={toggleTheme} />}>
      <Route index element={<DashboardRoute />} />
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="projects/:projectId" element={<ProjectDetailPage />} />
      <Route path="board" element={<KanbanRoute />} />
      <Route path="tasks" element={<TasksRoute />} />
      <Route path="team" element={<TeamPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></WorkspaceProvider></AuthProvider></BrowserRouter>
}
