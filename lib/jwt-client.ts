import { JwtPayload } from './jwt'
import { createNip98Token } from './nip98'
import type { NostrSigner } from '@nostrify/nostrify'

export interface JwtClientOptions {
  storageKey?: string
  baseUrl?: string
  autoRefresh?: boolean
  refreshThreshold?: number // seconds before expiry to refresh
}

export interface JwtTokenResponse {
  token: string
  expiresIn: string
  type: string
}

export class JwtClient {
  private storageKey: string
  private baseUrl: string
  private autoRefresh: boolean
  private refreshThreshold: number
  private signer: NostrSigner | null = null

  constructor(options: JwtClientOptions = {}) {
    this.storageKey = options.storageKey || 'jwt_token'
    this.baseUrl = options.baseUrl || '/api/jwt'
    this.autoRefresh = options.autoRefresh ?? true
    this.refreshThreshold = options.refreshThreshold || 300 // 5 minutes
  }

  /**
   * Set the Nostr signer used for NIP-98 authentication.
   * Must be called before login() or refreshToken().
   */
  setSigner(signer: NostrSigner): void {
    this.signer = signer
  }

  /**
   * Authenticate with NIP-98 and receive a JWT session token.
   * The signer must be set via setSigner() before calling this.
   * @param expiresIn - Optional token expiration (default: "1h")
   * @returns Promise<JwtTokenResponse>
   */
  async login(expiresIn?: string): Promise<JwtTokenResponse> {
    if (!this.signer) {
      throw new Error('Nostr signer not set. Call setSigner() first.')
    }

    const url = `${this.baseUrl}`
    const body = expiresIn ? JSON.stringify({ expiresIn }) : undefined
    const method = 'POST'

    const requestInit: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      body,
    }

    // Create NIP-98 auth header
    const absoluteUrl = this.resolveUrl(url)
    const nostrAuth = await createNip98Token(absoluteUrl, requestInit, this.signer)

    const response = await fetch(url, {
      ...requestInit,
      headers: {
        'Content-Type': 'application/json',
        Authorization: nostrAuth,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Login failed' }))
      throw new Error(error.error || 'Failed to authenticate')
    }

    const tokenData: JwtTokenResponse = await response.json()
    this.storeToken(tokenData.token)
    return tokenData
  }

  /**
   * Refresh the JWT by re-authenticating with NIP-98.
   * Requires the signer to be set.
   */
  async refreshToken(): Promise<JwtTokenResponse> {
    return this.login()
  }

  /**
   * Store JWT token in storage
   */
  storeToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.storageKey, token)
    }
  }

  /**
   * Get stored JWT token
   */
  getStoredToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(this.storageKey)
    }
    return null
  }

  /**
   * Remove stored JWT token
   */
  removeStoredToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.storageKey)
    }
  }

  /**
   * Check if a token is stored
   */
  hasStoredToken(): boolean {
    return this.getStoredToken() !== null
  }

  /**
   * Get the Authorization header value for requests
   */
  getAuthHeader(): string | null {
    const token = this.getStoredToken()
    return token ? `Bearer ${token}` : null
  }

  /**
   * Validate a stored token
   */
  async validateStoredToken(): Promise<boolean> {
    try {
      const token = this.getStoredToken()
      if (!token) return false

      const response = await fetch(`${this.baseUrl}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      return response.ok
    } catch (error) {
      console.error('Token validation error:', error)
      return false
    }
  }

  /**
   * Check if stored token needs refresh
   */
  shouldRefreshToken(): boolean {
    if (!this.autoRefresh) return false

    const token = this.getStoredToken()
    if (!token) return false

    try {
      const payload = this.decodeToken(token)
      if (!payload) return false

      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = payload.exp - now

      return timeUntilExpiry <= this.refreshThreshold
    } catch (error) {
      console.error('Error checking token expiry:', error)
      return true
    }
  }

  /**
   * Decode JWT token without verification (client-side only)
   */
  private decodeToken(token: string): JwtPayload | null {
    try {
      const base64Url = token.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )

      return JSON.parse(jsonPayload)
    } catch (error) {
      console.error('Failed to decode token:', error)
      return null
    }
  }

  /**
   * Make an authenticated request with automatic token refresh.
   * If the token is near expiry and a signer is set, refreshes automatically.
   */
  async authenticatedRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    // Auto-refresh if token is near expiry and signer is available
    if (this.shouldRefreshToken()) {
      if (this.signer) {
        await this.refreshToken()
      } else {
        this.removeStoredToken()
        throw new Error('Token expired. Call login() with a signer to re-authenticate.')
      }
    }

    const token = this.getStoredToken()
    if (!token) {
      throw new Error('No authentication token available. Call login() first.')
    }

    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)

    return fetch(url, {
      ...options,
      headers,
    })
  }

  /**
   * Logout by removing stored token and clearing signer
   */
  logout(): void {
    this.removeStoredToken()
    this.signer = null
  }

  private resolveUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
    }
    throw new Error('Cannot resolve relative URL in server environment')
  }
}

// Create a default instance
export const jwtClient = new JwtClient()

// Export convenience functions (bound to the default instance)
export const {
  storeToken,
  getStoredToken,
  removeStoredToken,
  hasStoredToken,
  getAuthHeader,
  validateStoredToken,
  authenticatedRequest,
  logout,
} = jwtClient
