import type { RemoteWalletType } from '@/lib/generated/prisma'

/**
 * Base class for everything a {@link RemoteWalletDriver} can throw. Route
 * handlers should catch these and translate to the right `ApiError` —
 * mapping happens at the API boundary so drivers stay protocol-agnostic.
 */
export class DriverError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DriverError'
  }
}

/**
 * Thrown by the registry when a wallet's `type` has no registered driver.
 * Usually a programming error (forgot to register a new driver) rather than
 * a runtime condition — surfaces as a 500 at the API layer.
 */
export class UnsupportedDriverError extends DriverError {
  constructor(public readonly type: RemoteWalletType | string) {
    super(`No driver registered for wallet type "${type}"`)
    this.name = 'UnsupportedDriverError'
  }
}

/**
 * Thrown when a wallet's `config` JSON fails the driver's schema check.
 * Indicates a corrupt or hand-edited row — should never come from a happy
 * write path, since writes also go through `configSchema`.
 */
export class DriverConfigError extends DriverError {
  constructor(
    public readonly type: RemoteWalletType | string,
    public readonly issues: unknown
  ) {
    super(`Invalid config for "${type}" driver`)
    this.name = 'DriverConfigError'
  }
}

/**
 * Thrown when the remote wallet rejects a payment / balance request, or the
 * underlying transport errors out (relay timeout, network blip, …). Carries
 * the original error so logs can keep the protocol-level context.
 */
export class DriverRemoteError extends DriverError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DriverRemoteError'
  }
}

/** The wallet returned a definitive NIP-47 rejection. Safe to surface as final. */
export class PaymentRejectedError extends DriverRemoteError {
  constructor(
    message: string,
    options?: {
      cause?: unknown
      code?: string
      transport?: 'DIRECT' | 'LISTENER'
    }
  ) {
    super(message, options)
    this.name = 'PaymentRejectedError'
    this.code = options?.code
    this.transport = options?.transport
  }

  readonly code?: string
  readonly transport?: 'DIRECT' | 'LISTENER'
}

/**
 * The payment may have been published, but no definitive result was observed.
 * Callers must reconcile the SAME request and must never dispatch it again.
 */
export class PaymentOutcomeUnknownError extends DriverRemoteError {
  constructor(
    message: string,
    public readonly transport: 'DIRECT' | 'LISTENER',
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'PaymentOutcomeUnknownError'
  }
}
