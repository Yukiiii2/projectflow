import { AlertTriangle, LoaderCircle, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { Brand } from '../components/Brand'
import { useWorkspaces } from './WorkspaceContext'
import { WorkspaceSetup } from './WorkspaceSetup'

interface WorkspaceGateProps {
  children: ReactNode
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function WorkspaceGate({ children, theme, onToggleTheme }: WorkspaceGateProps) {
  const { status, workspaces, error, reload } = useWorkspaces()

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="workspace-boundary" role="status" aria-live="polite">
        <Brand />
        <div className="workspace-boundary__card">
          <LoaderCircle className="spin" size={26} aria-hidden="true" />
          <h1>Loading your workspaces</h1>
          <p>Checking your membership and restoring your last workspace.</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="workspace-boundary">
        <header className="workspace-page__header">
          <Brand />
          <button type="button" className="icon-button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>
        <main className="workspace-page__main">
          <section className="workspace-boundary__card" aria-labelledby="workspace-load-error">
            <span className="workspace-boundary__error"><AlertTriangle size={24} aria-hidden="true" /></span>
            <h1 id="workspace-load-error">We could not load your workspaces</h1>
            <p>{error}</p>
            <button type="button" className="button button--primary" onClick={() => void reload()}>Try again</button>
          </section>
        </main>
      </div>
    )
  }

  if (workspaces.length === 0) return <WorkspaceSetup firstWorkspace theme={theme} onToggleTheme={onToggleTheme} />
  return children
}
