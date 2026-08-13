/** JSON error envelope every LaWallet API error response carries. */
export interface LaWalletApiError {
  message: string
  code: string
  details?: unknown
}

/**
 * Thrown for non-2xx API responses (and for local misconfiguration such as a
 * missing signer). Carries the HTTP status and the server-side error code so
 * callers can branch on specific cases (e.g. `status === 402` for
 * payment-required registration) without parsing messages.
 */
export class LaWalletError extends Error {
  public readonly status: number
  public readonly code?: string
  public readonly details?: unknown

  constructor(
    status: number,
    message: string,
    code?: string,
    details?: unknown
  ) {
    super(message)
    this.name = 'LaWalletError'
    this.status = status
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
