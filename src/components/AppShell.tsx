import {
  Bell,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Columns3,
  FolderKanban,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthUser } from '../auth/api'
import type { Workspace } from '../domain/types'
import type { WorkspaceRole, WorkspaceSummary } from '../workspaces/api'
import { workspaceInitials } from '../workspaces/dashboardFixture'
import { Avatar } from './Avatar'
import { Brand } from './Brand'
import { useModalFocus } from './useModalFocus'

interface AppShellProps {
  children: ReactNode
  user: AuthUser
  workspace: Workspace
  workspaceOptions: WorkspaceSummary[]
  workspaceRole: WorkspaceRole
  workspaceId: string
  onWorkspaceChange: (id: string) => void
  onCreateWorkspace: () => void
  allowWorkspaceCreation: boolean
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  mobileDrawerOpen: boolean
  onMobileDrawerChange: (open: boolean) => void
  onUnavailable: (feature: string) => void
  onCreateTask: () => void
  onSignOut: () => void
  signingOut: boolean
  currentPath: string
  onRouteChange: (path: string) => void
}

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Projects', icon: FolderKanban, path: '/projects' },
  { label: 'Board', icon: Columns3, path: '/board' },
  { label: 'My tasks', icon: CheckSquare2, path: '/tasks' },
  { label: 'Team', icon: Users, path: '/team' },
  { label: 'Calendar', icon: CalendarDays, badge: 'V1.1' },
]

interface SidebarContentProps {
  collapsed?: boolean
  selectId: string
  workspaces: WorkspaceSummary[]
  workspaceRole: WorkspaceRole
  workspaceId: string
  onWorkspaceChange: (id: string) => void
  onCreateWorkspace: () => void
  allowWorkspaceCreation: boolean
  onUnavailable: (feature: string) => void
  currentPath: string
  onRouteChange: (path: string) => void
  onNavigate?: () => void
}

function SidebarContent({
  collapsed = false,
  selectId,
  workspaces,
  workspaceRole,
  workspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
  allowWorkspaceCreation,
  onUnavailable,
  currentPath,
  onRouteChange,
  onNavigate,
}: SidebarContentProps) {
  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId)
  const roleLabel = `${workspaceRole[0].toUpperCase()}${workspaceRole.slice(1)}`
  const activate = (label: string, path?: string) => {
    if (path) onRouteChange(path)
    else onUnavailable(label)
    onNavigate?.()
  }

  return (
    <>
      <div className="sidebar__brand-row">
        <Brand collapsed={collapsed} />
      </div>

      <div className="workspace-control">
        {!collapsed && <label htmlFor={selectId}>Workspace</label>}
        <div className="select-shell select-shell--workspace">
          {!collapsed && <span className="workspace-avatar">{workspaceInitials(selectedWorkspace?.name ?? '')}</span>}
          <span className="workspace-compact-label" aria-hidden="true">
            {workspaceInitials(selectedWorkspace?.name ?? '')}
          </span>
          <select
            id={selectId}
            aria-label="Workspace"
            value={workspaceId}
            onChange={(event) => onWorkspaceChange(event.target.value)}
          >
            {workspaces.map((item) => (
              <option value={item.id} key={item.id}>
                {collapsed ? workspaceInitials(item.name) : item.name}
              </option>
            ))}
          </select>
          {!collapsed && <ChevronDown size={15} aria-hidden="true" />}
        </div>
        <div className="workspace-control__meta">
          {!collapsed && <span data-testid="workspace-role">{roleLabel}</span>}
          {allowWorkspaceCreation && <button
            type="button"
            className="workspace-create-button"
            aria-label="Create workspace"
            data-tooltip={collapsed ? 'Create workspace' : undefined}
            onClick={() => {
              onCreateWorkspace()
              onNavigate?.()
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {!collapsed && <span>New workspace</span>}
          </button>}
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {!collapsed && <span className="nav-kicker">Workspace</span>}
        {navItems.map((item) => {
          const Icon = item.icon
          const current = item.path === '/' ? currentPath === '/' : Boolean(item.path && currentPath.startsWith(item.path))
          return (
            <button
              type="button"
              key={item.label}
              className={`nav-item ${current ? 'is-current' : ''}`}
              aria-current={current ? 'page' : undefined}
              aria-label={collapsed ? item.label : undefined}
              data-tooltip={collapsed ? item.label : undefined}
              onClick={() => activate(item.label, item.path)}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.badge && <span className="nav-item__badge">{item.badge}</span>}
            </button>
          )
        })}
      </nav>

      <nav className="sidebar__nav sidebar__nav--secondary" aria-label="Support navigation">
        <button
          type="button"
          className="nav-item"
          aria-label="Settings"
          data-tooltip={collapsed ? 'Settings' : undefined}
          onClick={() => activate('Settings')}
        >
          <Settings size={19} strokeWidth={1.8} aria-hidden="true" />
          {!collapsed && <span>Settings</span>}
        </button>
        <button
          type="button"
          className="nav-item"
          aria-label={collapsed ? 'Help and support' : 'Help & support'}
          data-tooltip={collapsed ? 'Help and support' : undefined}
          onClick={() => activate('Help and support')}
        >
          <CircleHelp size={19} strokeWidth={1.8} aria-hidden="true" />
          {!collapsed && <span>Help & support</span>}
        </button>
      </nav>
    </>
  )
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'PF'
}

interface ProfileMenuProps {
  user: AuthUser
  signingOut: boolean
  onSignOut: () => void
  onUnavailable: (feature: string) => void
}

function ProfileMenu({ user, signingOut, onSignOut, onUnavailable }: ProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const select = (label: string) => {
    setOpen(false)
    if (label === 'Sign out') onSignOut()
    else onUnavailable(label)
  }

  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span><Avatar person={{ id: user.id, name: user.name, initials: initialsFor(user.name), color: '#8B6BE8' }} /></span>
        <span className="profile-button__copy">
          <strong>{user.name}</strong>
          <span>{user.demo ? 'Temporary demo' : 'ProjectFlow account'}</span>
        </span>
        <span className="sr-only">Open profile menu</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu-popover"
            role="menu"
            aria-label="Profile menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
          >
            <div className="menu-popover__header">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            {!user.demo && <button type="button" role="menuitem" onClick={() => select('Profile settings')}>Profile settings</button>}
            {!user.demo && <button type="button" role="menuitem" onClick={() => select('Account preferences')}>Account preferences</button>}
            <button type="button" role="menuitem" disabled={signingOut} onClick={() => select('Sign out')}>
              {signingOut && <LoaderCircle className="spin" size={15} aria-hidden="true" />}
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AppShell({
  children,
  user,
  workspace,
  workspaceOptions,
  workspaceRole,
  workspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
  allowWorkspaceCreation,
  theme,
  onToggleTheme,
  sidebarCollapsed,
  onToggleSidebar,
  mobileDrawerOpen,
  onMobileDrawerChange,
  onUnavailable,
  onCreateTask,
  onSignOut,
  signingOut,
  currentPath,
  onRouteChange,
}: AppShellProps) {
  const mobileDrawerRef = useRef<HTMLElement>(null)
  const mobileDrawerCloseRef = useRef<HTMLButtonElement>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  useModalFocus(mobileDrawerRef, () => onMobileDrawerChange(false), false, mobileDrawerCloseRef, mobileDrawerOpen)
  const sectionLabel = currentPath.startsWith('/projects') ? 'Projects' : currentPath.startsWith('/board') ? 'Board' : currentPath.startsWith('/tasks') ? 'My tasks' : currentPath.startsWith('/team') ? 'Team' : 'Dashboard'
  return (
    <div className="app-root flex min-h-screen" data-sidebar-collapsed={sidebarCollapsed}>
      <aside className="sidebar" aria-label="ProjectFlow sidebar">
        <SidebarContent
          collapsed={sidebarCollapsed}
          selectId="workspace-select"
          workspaces={workspaceOptions}
          workspaceRole={workspaceRole}
          workspaceId={workspaceId}
          onWorkspaceChange={onWorkspaceChange}
          onCreateWorkspace={onCreateWorkspace}
          allowWorkspaceCreation={allowWorkspaceCreation}
          onUnavailable={onUnavailable}
          currentPath={currentPath}
          onRouteChange={onRouteChange}
        />
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          data-tooltip={sidebarCollapsed ? 'Expand sidebar' : undefined}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          {!sidebarCollapsed && <span>Collapse sidebar</span>}
        </button>
      </aside>

      <AnimatePresence onExitComplete={() => mobileMenuButtonRef.current?.focus()}>
        {mobileDrawerOpen && (
          <>
            <motion.button
              type="button"
              className="drawer-backdrop"
              aria-label="Close navigation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => onMobileDrawerChange(false)}
            />
            <motion.aside
              ref={mobileDrawerRef}
              className="mobile-drawer"
              aria-label="Mobile navigation"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            >
              <button
                ref={mobileDrawerCloseRef}
                type="button"
                className="drawer-close icon-button"
                aria-label="Close navigation drawer"
                onClick={() => onMobileDrawerChange(false)}
              >
                <X size={20} />
              </button>
              <SidebarContent
                selectId="mobile-workspace-select"
                workspaces={workspaceOptions}
                workspaceRole={workspaceRole}
                workspaceId={workspaceId}
                onWorkspaceChange={(id) => {
                  onWorkspaceChange(id)
                  onMobileDrawerChange(false)
                }}
                onCreateWorkspace={onCreateWorkspace}
                allowWorkspaceCreation={allowWorkspaceCreation}
                onUnavailable={onUnavailable}
                currentPath={currentPath}
                onRouteChange={onRouteChange}
                onNavigate={() => onMobileDrawerChange(false)}
              />
              <div className="drawer-account">
                <Avatar person={{ id: user.id, name: user.name, initials: initialsFor(user.name), color: '#8B6BE8' }} />
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
                <button type="button" className="icon-button" aria-label="Sign out" disabled={signingOut} onClick={onSignOut}>
                  {signingOut ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__leading">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              className="mobile-menu-button icon-button"
              aria-label="Open navigation drawer"
              onClick={() => onMobileDrawerChange(true)}
            >
              <Menu size={20} />
            </button>
            <div className="topbar__workspace-copy">
              <span>{workspace.name}</span>
              <small>{sectionLabel}</small>
            </div>
          </div>

          <div className="topbar__actions">
            <button
              type="button"
              className="search-trigger"
              onClick={() => onUnavailable('Global search')}
            >
              <Search size={18} aria-hidden="true" />
              <span>Search</span>
              <kbd aria-hidden="true">⌘ K</kbd>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Open notifications"
              data-tooltip="Notifications"
              onClick={() => onUnavailable('Notifications')}
            >
              <Bell size={19} />
              <span className="notification-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              data-tooltip={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <ProfileMenu user={user} signingOut={signingOut} onSignOut={onSignOut} onUnavailable={onUnavailable} />
          </div>
        </header>

        {user.demo && <div className="demo-banner" role="status" aria-live="polite">
          <strong>Private demo workspace</strong>
          <span>Your changes are isolated from other visitors and cleared after 30 minutes.</span>
        </div>}

        <main className="main-content">{children}</main>

        <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
          <button type="button" className={currentPath === '/' ? 'is-current' : ''} aria-current={currentPath === '/' ? 'page' : undefined} onClick={() => onRouteChange('/')}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </button>
          <button type="button" className={currentPath.startsWith('/board') ? 'is-current' : ''} aria-current={currentPath.startsWith('/board') ? 'page' : undefined} onClick={() => onRouteChange('/board')}>
            <Columns3 size={20} />
            <span>Board</span>
          </button>
          <button type="button" className="mobile-create" onClick={onCreateTask} aria-label="Create task">
            <Plus size={22} />
          </button>
          <button type="button" className={currentPath.startsWith('/tasks') ? 'is-current' : ''} aria-current={currentPath.startsWith('/tasks') ? 'page' : undefined} onClick={() => onRouteChange('/tasks')}>
            <CheckSquare2 size={20} />
            <span>Tasks</span>
          </button>
          <button type="button" className={currentPath.startsWith('/team') ? 'is-current' : ''} aria-current={currentPath.startsWith('/team') ? 'page' : undefined} onClick={() => onRouteChange('/team')}>
            <Users size={20} />
            <span>Team</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
