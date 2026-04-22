export interface ApiError {
  message: string
  code: string
  details?: unknown
}

/**
 * Thrown by the API client for non-2xx responses. Carries the HTTP
 * status and the server-side error code so callers can branch on
 * specific cases (e.g. 402 PAYMENT_REQUIRED) without resorting to
 * brittle message parsing.
 */
export class ApiClientError extends Error {
  public readonly status: number
  public readonly code?: string
  public readonly details?: unknown

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
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

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const apiError = errorBody?.error as ApiError | undefined

      if (response.status === 401) {
        // Only logout if there's no valid token (true auth failure).
        // Permission-denied 401s should not force logout.
        const token = getToken()
        if (!token) {
          onUnauthorized?.()
        }
      }

      const defaultMessage =
        response.status === 401
          ? 'Unauthorized'
          : response.status === 403
            ? 'Insufficient permissions'
            : `Request failed (${response.status})`
      throw new ApiClientError(
        response.status,
        apiError?.message || defaultMessage,
        apiError?.code,
        apiError?.details,
      )
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
