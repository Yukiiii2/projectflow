import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authApi from './api'
import { defaultPublicAvailability, sessionExpiredEvent, type AuthUser, type PublicAvailability } from './api'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  notice: string
  availability: PublicAvailability
  clearNotice: () => void
  retrySession: () => Promise<void>
  refreshUser: () => Promise<AuthUser | null>
  expireSession: () => void
  login: (email: string, password: string) => Promise<void>
  createAccount: (name: string, email: string, password: string) => Promise<void>
  enterDemo: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [notice, setNotice] = useState('')
  const [availability, setAvailability] = useState<PublicAvailability>(defaultPublicAvailability)

  const loadSession = useCallback(async (initial = false) => {
    if (initial) setStatus('loading')
    try {
      const restored = await authApi.restoreSession()
      const restoredUser = restored.user
      setAvailability(restored.availability)
      if (restoredUser) {
        setUser(restoredUser)
        setStatus('authenticated')
        setNotice('')
      } else {
        setUser(null)
        setStatus('unauthenticated')
        if (!initial) setNotice('Your session has expired. Sign in again to continue.')
      }
    } catch (error) {
      if (initial) {
        setUser(null)
        setStatus('unauthenticated')
        setNotice(error instanceof Error ? error.message : 'Could not restore your session.')
      }
    }
  }, [])

  useEffect(() => {
    void loadSession(true)
  }, [loadSession])

  useEffect(() => {
    if (status !== 'authenticated') return
    const revalidate = () => { void loadSession(false) }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') revalidate()
    }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadSession, status])

  const expireSession = useCallback(() => {
    setUser(null)
    setStatus('unauthenticated')
    setNotice('Your session has expired. Sign in again to continue.')
  }, [])

  useEffect(() => {
    window.addEventListener(sessionExpiredEvent, expireSession)
    return () => window.removeEventListener(sessionExpiredEvent, expireSession)
  }, [expireSession])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    notice,
    availability,
    clearNotice: () => setNotice(''),
    retrySession: () => loadSession(true),
    refreshUser: async () => {
      const restored = await authApi.restoreSession()
      const restoredUser = restored.user
      setAvailability(restored.availability)
      setUser(restoredUser)
      setStatus(restoredUser ? 'authenticated' : 'unauthenticated')
      return restoredUser
    },
    expireSession,
    login: async (email, password) => {
      const authenticatedUser = await authApi.signIn(email, password)
      setUser(authenticatedUser)
      setStatus('authenticated')
      setNotice('')
    },
    createAccount: async (name, email, password) => {
      const authenticatedUser = await authApi.register(name, email, password)
      setUser(authenticatedUser)
      setStatus('authenticated')
      setNotice('')
    },
    enterDemo: async () => {
      const demoUser = await authApi.startDemo()
      setUser(demoUser)
      setStatus('authenticated')
      setNotice('')
    },
    logout: async () => {
      try {
        await authApi.signOut()
        setNotice('')
      } catch {
        setNotice('Signed out locally. The API could not confirm that the server session was closed.')
      } finally {
        setUser(null)
        setStatus('unauthenticated')
      }
    },
  }), [availability, expireSession, loadSession, notice, status, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
