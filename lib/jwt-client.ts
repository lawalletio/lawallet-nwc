import { JwtPayload } from './jwt'

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

  constructor(options: JwtClientOptions = {}) {
    this.storageKey = options.storageKey || 'jwt_token'
    this.baseUrl = options.baseUrl || '/api/jwt'
    this.autoRefresh = options.autoRefresh ?? true
    this.refreshThreshold = options.refreshThreshold || 300 // 5 minutes
  }

  /**
   * Request a new JWT token
   * @param userId - The user ID for the token
   * @param additionalClaims - Additional claims to include
   * @param expiresIn - Token expiration time
   * @returns Promise<JwtTokenResponse>
   */
  async requestToken(
    userId: string,
    additionalClaims?: Record<string, any>,
    expiresIn?: string
  ): Promise<JwtTokenResponse> {
    try {
      const response = await fetch(`${this.baseUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          additionalClaims,
          expiresIn
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to request token')
      }

      const tokenData = await response.json()

      // Store the token
      this.storeToken(tokenData.token)

      return tokenData
    } catch (error) {
      console.error('Failed to request JWT token:', error)
      throw error
    }
  }

  /**
   * Store JWT token in storage
   * @param token - The JWT token to store
   */
  storeToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.storageKey, token)
    }
  }

  /**
   * Get stored JWT token
   * @returns string | null - The stored token or null if not found
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
   * @returns boolean - True if token exists
   */
  hasStoredToken(): boolean {
    return this.getStoredToken() !== null
  }

  /**
   * Get the Authorization header value for requests
   * @returns string | null - The Authorization header value or null if no token
   */
  getAuthHeader(): string | null {
    const token = this.getStoredToken()
    return token ? `Bearer ${token}` : null
  }

  /**
   * Validate a stored token
   * @returns Promise<boolean> - True if token is valid
   */
  async validateStoredToken(): Promise<boolean> {
    try {
      const token = this.getStoredToken()
      if (!token) return false

      const response = await fetch(`${this.baseUrl}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      return response.ok
    } catch (error) {
      console.error('Token validation error:', error)
      return false
    }
  }

  /**
   * Check if stored token needs refresh
   * @returns boolean - True if token should be refreshed
   */
  shouldRefreshToken(): boolean {
    if (!this.autoRefresh) return false

    const token = this.getStoredToken()
    if (!token) return false

    try {
      // Decode token to check expiration
      const payload = this.decodeToken(token)
      if (!payload) return false

      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = payload.exp - now

      return timeUntilExpiry <= this.refreshThreshold
    } catch (error) {
      console.error('Error checking token expiry:', error)
      return true // Refresh if we can't determine expiry
    }
  }

  /**
   * Decode JWT token without verification (client-side only)
   * @param token - The JWT token to decode
   * @returns JwtPayload | null - The decoded payload or null if invalid
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
   * Make an authenticated request with automatic token handling
   * @param url - The URL to request
   * @param options - Fetch options
   * @returns Promise<Response>
   */
  async authenticatedRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    // Check if token needs refresh
    if (this.shouldRefreshToken()) {
      console.log('Token needs refresh, attempting to refresh...')
      // You might want to implement a refresh token flow here
      // For now, we'll just remove the expired token
      this.removeStoredToken()
      throw new Error('Token expired and refresh not implemented')
    }

    const token = this.getStoredToken()
    if (!token) {
      throw new Error('No authentication token available')
    }

    // Add Authorization header
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)

    return fetch(url, {
      ...options,
      headers
    })
  }

  /**
   * Logout by removing stored token
   */
  logout(): void {
    this.removeStoredToken()
  }
}

// Create a default instance
export const jwtClient = new JwtClient()

// Export convenience functions
export const {
  requestToken,
  storeToken,
  getStoredToken,
  removeStoredToken,
  hasStoredToken,
  getAuthHeader,
  validateStoredToken,
  authenticatedRequest,
  logout
} = jwtClient

