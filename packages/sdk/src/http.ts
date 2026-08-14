import { LaWalletError, type LaWalletApiError } from './errors'

/**
 * Builds the Authorization header for one request, or returns null to send it
 * unauthenticated. Called with the absolute URL and the exact method/body so
 * NIP-98 signatures can commit to them.
 */
export type AuthHeaderProvider = (
  url: string,
  init: { method: string; body?: string }
) => Promise<string | null>

export interface HttpRequestOptions {
  /** Set false for public endpoints so no signature is requested. Default true. */
  auth?: boolean
}

export interface HttpClient {
  get<T>(path: string, opts?: HttpRequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, opts?: HttpRequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, opts?: HttpRequestOptions): Promise<T>
  patch<T>(path: string, body?: unknown, opts?: HttpRequestOptions): Promise<T>
  del<T>(path: string, opts?: HttpRequestOptions): Promise<T>
}

export interface HttpClientOptions {
  /** Instance origin, no trailing slash. */
  endpoint: string
  getAuthHeader: AuthHeaderProvider
  onUnauthorized?: () => void
  fetchImpl?: typeof fetch
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { endpoint, getAuthHeader, onUnauthorized } = options
  const doFetch =
    options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function request<T>(
    path: string,
    init: { method: string; body?: unknown },
    opts?: HttpRequestOptions
  ): Promise<T> {
    const url = endpoint + path
    const body = init.body !== undefined ? JSON.stringify(init.body) : undefined

    const headers: Record<string, string> = {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    if (opts?.auth !== false) {
      const authHeader = await getAuthHeader(url, { method: init.method, body })
      if (authHeader) {
        headers['Authorization'] = authHeader
      }
    }

    const response = await doFetch(url, { method: init.method, headers, body })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const apiError = errorBody?.error as LaWalletApiError | undefined

      if (response.status === 401) {
        onUnauthorized?.()
      }

      const defaultMessage =
        response.status === 401
          ? 'Unauthorized'
          : response.status === 403
            ? 'Insufficient permissions'
            : `Request failed (${response.status})`
      throw new LaWalletError(
        response.status,
        apiError?.message || defaultMessage,
        apiError?.code,
        apiError?.details
      )
    }

    // Handle empty responses (204 No Content, etc.)
    const text = await response.text()
    if (!text) return undefined as T

    return JSON.parse(text) as T
  }

  return {
    get: (path, opts) => request(path, { method: 'GET' }, opts),
    post: (path, body, opts) => request(path, { method: 'POST', body }, opts),
    put: (path, body, opts) => request(path, { method: 'PUT', body }, opts),
    patch: (path, body, opts) => request(path, { method: 'PATCH', body }, opts),
    del: (path, opts) => request(path, { method: 'DELETE' }, opts)
  }
}
