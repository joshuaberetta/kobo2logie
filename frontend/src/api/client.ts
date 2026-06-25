import type {
  ConditionGroup,
  LogsResponse,
  ProjectConfig,
  SurveyQuestion,
} from '../types'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  return match ? match[1] : null
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  const csrfToken = getCsrfToken()
  if (csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || '')) {
    headers['X-CSRFToken'] = csrfToken
  }

  const response = await fetch(url, { ...options, headers, credentials: 'include' })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

export interface User {
  id: number
  username: string
  email: string
}

export interface AuthResponse {
  authenticated: boolean
  user: User | null
}

export interface LoginResponse {
  message: string
  user: User
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<LoginResponse>('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),

    logout: () =>
      request<{ message: string }>('/auth/logout/', {
        method: 'POST',
      }),

    me: () => request<AuthResponse>('/auth/me/'),
  },

  config: {
    get: (uid: string) => request<ProjectConfig>(`/configure/project/${uid}/`),

    save: (uid: string, data: Partial<ProjectConfig>) =>
      request<{ ok: boolean }>(`/configure/project/${uid}/`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    survey: (uid: string) =>
      request<{ questions: SurveyQuestion[] }>(`/configure/survey/${uid}/`),

    setupRestService: (server: string, uid: string, token: string) =>
      request<{ already_exists?: boolean; uid?: string; url?: string }>(
        '/configure/rest-service/',
        { method: 'POST', body: JSON.stringify({ server, uid, token }) },
      ),

    setupPermissions: (server: string, uid: string, token: string) =>
      request<{ already_exists?: boolean }>('/configure/permissions/', {
        method: 'POST',
        body: JSON.stringify({ server, uid, token }),
      }),

    generateCondition: (prompt: string, currentCondition?: ConditionGroup | null) =>
      request<{ condition: ConditionGroup }>('/configure/condition/generate/', {
        method: 'POST',
        body: JSON.stringify({ prompt, currentCondition }),
      }),
  },

  logs: {
    list: (uid: string, page = 1, pageSize = 20) =>
      request<LogsResponse>(`/logs/${uid}/?page=${page}&page_size=${pageSize}`),
  },

  submissions: {
    retry: (uid: string, uuid: string) =>
      request<{ ok: boolean }>(`/retry/${uid}/`, {
        method: 'POST',
        body: JSON.stringify({ uuid }),
      }),
  },

  media: {
    proxyUrl: (url: string) => `${API_BASE}/media/?url=${encodeURIComponent(url)}`,
  },
}
