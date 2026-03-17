export interface ApiError {
  message: string
  code: string
  details?: unknown
}

export interface ApiClientOptions {
  getToken: () => string | null
  onUnauthorized?: () => void
}

export interface ApiClient {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  put: <T>(path: string, body?: unknown) => Promise<T>
  del: <T>(path: string) => Promise<T>
}

/**
 * Creates an authenticated API client that attaches the JWT token
 * to all requests and handles error responses.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const { getToken, onUnauthorized } = options

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = getToken()
    const headers: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(init?.headers ?? {}).filter(([, v]) => v != null)
      ),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    if (init?.body && typeof init.body === 'string') {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(path, {
      ...init,
      headers,
    })

    if (response.status === 401) {
      onUnauthorized?.()
      throw new Error('Session expired. Please log in again.')
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const apiError = errorBody?.error as ApiError | undefined
      throw new Error(apiError?.message || `Request failed (${response.status})`)
    }

    // Handle empty responses (204 No Content, etc.)
    const text = await response.text()
    if (!text) return undefined as T

    return JSON.parse(text) as T
  }

  return {
    get: <T>(path: string) =>
      request<T>(path, { method: 'GET' }),

    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),

    put: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: 'PUT',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),

    del: <T>(path: string) =>
      request<T>(path, { method: 'DELETE' }),
  }
}
