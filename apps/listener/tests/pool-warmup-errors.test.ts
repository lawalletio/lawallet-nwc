import { describe, expect, it, vi } from 'vitest'
import { Nip47TimeoutError } from '@getalby/sdk'
import { isRetryableWarmupError } from '../src/nwc/pool'

describe('isRetryableWarmupError', () => {
  it('returns true for Nip47TimeoutError', () => {
    const err = new Nip47TimeoutError('reply timeout', 'test_method')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns true for "no info event" error message', () => {
    const err = new Error('no info event (kind 13194) returned from relay')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns true for "kind 13194" in error message', () => {
    const err = new Error('relay did not return kind 13194')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns true for warmup timeout error', () => {
    const err = new Error('NWC get_info warm-up timed out')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns true for SDK reply timeout message', () => {
    const err = new Error('reply timeout from @getalby/sdk NWCClient')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns true for case-insensitive match', () => {
    const err = new Error('NO INFO EVENT returned')
    expect(isRetryableWarmupError(err)).toBe(true)
  })

  it('returns false for wallet-level errors', () => {
    const err = new Error('INSUFFICIENT_BALANCE')
    expect(isRetryableWarmupError(err)).toBe(false)
  })

  it('returns false for generic connection errors', () => {
    const err = new Error('Connection refused')
    expect(isRetryableWarmupError(err)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isRetryableWarmupError('string error')).toBe(false)
    expect(isRetryableWarmupError(null)).toBe(false)
    expect(isRetryableWarmupError(undefined)).toBe(false)
    expect(isRetryableWarmupError(42)).toBe(false)
  })
})

describe('NwcPool warmup error handling', () => {
  it('should not call onWalletError for retryable errors on first attempts', async () => {
    const onWalletError = vi.fn()
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn()
    }

    // Simulate the decision logic from pool.ts connect() catch block
    const error = new Error('no info event (kind 13194) returned from relay')
    const isRetryable = isRetryableWarmupError(error)
    let retryAttempt = 0
    let errorNotified = false
    const WARMUP_RETRY_SENTRY_THRESHOLD = 3

    // First attempt (retryAttempt = 0)
    const shouldReport1 =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport1) {
      errorNotified = true
      onWalletError()
    }
    retryAttempt++

    expect(shouldReport1).toBe(false)
    expect(onWalletError).not.toHaveBeenCalled()

    // Second attempt (retryAttempt = 1)
    const shouldReport2 =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport2) {
      errorNotified = true
      onWalletError()
    }
    retryAttempt++

    expect(shouldReport2).toBe(false)
    expect(onWalletError).not.toHaveBeenCalled()

    // Third attempt (retryAttempt = 2)
    const shouldReport3 =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport3) {
      errorNotified = true
      onWalletError()
    }
    retryAttempt++

    expect(shouldReport3).toBe(false)
    expect(onWalletError).not.toHaveBeenCalled()

    // Fourth attempt (retryAttempt = 3) - threshold reached
    const shouldReport4 =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport4) {
      errorNotified = true
      onWalletError()
    }

    expect(shouldReport4).toBe(true)
    expect(onWalletError).toHaveBeenCalledTimes(1)
  })

  it('should call onWalletError immediately for non-retryable errors', () => {
    const onWalletError = vi.fn()

    const error = new Error('INSUFFICIENT_BALANCE: not enough funds')
    const isRetryable = isRetryableWarmupError(error)
    const retryAttempt = 0
    let errorNotified = false
    const WARMUP_RETRY_SENTRY_THRESHOLD = 3

    const shouldReport =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport) {
      errorNotified = true
      onWalletError()
    }

    expect(isRetryable).toBe(false)
    expect(shouldReport).toBe(true)
    expect(onWalletError).toHaveBeenCalledTimes(1)
  })

  it('only reports once even after threshold (errorNotified guard)', () => {
    const onWalletError = vi.fn()

    const error = new Error('no info event (kind 13194) returned from relay')
    const isRetryable = isRetryableWarmupError(error)
    let errorNotified = false
    const WARMUP_RETRY_SENTRY_THRESHOLD = 3

    // Simulate reaching threshold and beyond
    for (let retryAttempt = 0; retryAttempt <= 5; retryAttempt++) {
      const shouldReport =
        !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
      if (!errorNotified && shouldReport) {
        errorNotified = true
        onWalletError()
      }
    }

    // Should only be called once (at retryAttempt = 3)
    expect(onWalletError).toHaveBeenCalledTimes(1)
  })

  it('handles Nip47TimeoutError as retryable', () => {
    const onWalletError = vi.fn()

    const error = new Nip47TimeoutError(
      'reply timeout from @getalby/sdk NWCClient',
      'get_info'
    )
    const isRetryable = isRetryableWarmupError(error)
    const retryAttempt = 0
    let errorNotified = false
    const WARMUP_RETRY_SENTRY_THRESHOLD = 3

    const shouldReport =
      !isRetryable || retryAttempt >= WARMUP_RETRY_SENTRY_THRESHOLD
    if (!errorNotified && shouldReport) {
      errorNotified = true
      onWalletError()
    }

    expect(isRetryable).toBe(true)
    expect(shouldReport).toBe(false)
    expect(onWalletError).not.toHaveBeenCalled()
  })
})
