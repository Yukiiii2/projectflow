import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useAuth } from './AuthContext'

function SessionLoader() {
  return (
    <main className="session-loader" aria-live="polite" aria-busy="true">
      <Brand />
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <p>Restoring your session…</p>
    </main>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionLoader />
  if (status === 'unauthenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionLoader />
  if (status === 'authenticated') {
    const state = location.state as { from?: string } | null
    const destination = state?.from?.startsWith('/') ? state.from : '/'
    return <Navigate to={destination} replace />
  }
  return children
}

export function VerifiedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.email_verification_required && user.email_verified === false) return <Navigate to="/verify-email" replace />
  return children
}
