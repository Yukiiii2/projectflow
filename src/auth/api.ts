export interface AuthUser {
  id: string
  name: string
  email: string
  created_at?: string
  email_verified?: boolean
  email_verification_required?: boolean
}

interface AuthResponse {
  user: AuthUser
}

interface ErrorResponse {
  error?: string
}

export function resolveApiBaseUrl(configured: string | undefined, fallback: string) {
  return (configured ?? fallback).replace(/\/$/, '')
}

const apiBaseUrl = import.meta.env.DEV
  ? resolveApiBaseUrl(import.meta.env.VITE_API_URL, 'http://localhost:4000')
  : ''
export const sessionExpiredEvent = 'projectflow:session-expired'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function messageFor(status: number, fallback?: string, messages: Partial<Record<number, string>> = {}) {
  if (messages[status]) return messages[status]
  if (status === 401) return 'Your session has expired. Sign in again to continue.'
  if (status === 403) return 'You do not have permission to complete this action.'
  if (status >= 500) return 'ProjectFlow could not complete the request. Try again in a moment.'
  return fallback || 'ProjectFlow could not complete the request.'
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  messages: Partial<Record<number, string>> = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Could not reach the ProjectFlow API. Confirm the backend is running and try again.')
  }

  if (response.status === 204) return undefined as T

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(sessionExpiredEvent))
    }
    const serverMessage = typeof body === 'object' && body !== null && 'error' in body
      ? (body as ErrorResponse).error
      : undefined
    throw new ApiError(response.status, messageFor(response.status, serverMessage, messages))
  }

  return body as T
}

export async function restoreSession() {
  try {
    const response = await apiRequest<AuthResponse>('/api/auth/me')
    return response.user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function signIn(email: string, password: string) {
  const response = await apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, { 401: 'Email or password is incorrect.', 403: 'This request could not be verified. Refresh the page and try again.' })
  return response.user
}

export async function register(name: string, email: string, password: string) {
  const response = await apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  }, { 409: 'An account with this email already exists.', 403: 'This request could not be verified. Refresh the page and try again.' })
  return response.user
}

export async function signOut() {
  try {
    await apiRequest<void>('/api/auth/logout', { method: 'POST' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return
    throw error
  }
}

export async function requestPasswordReset(email: string) {
  return apiRequest<{ message: string }>('/api/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function confirmPasswordReset(token: string, password: string) {
  await apiRequest<void>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  }, { 400: 'This password reset link is invalid or has expired.' })
}

export async function requestEmailVerification() {
  return apiRequest<{ message: string }>('/api/auth/email-verification/request', { method: 'POST' })
}

export async function confirmEmailVerification(token: string) {
  return apiRequest<{ message: string }>('/api/auth/email-verification/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }, { 400: 'This verification link is invalid or has expired.' })
}
