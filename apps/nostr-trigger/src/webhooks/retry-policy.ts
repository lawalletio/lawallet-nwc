import { getConfig } from '../config/index.js'

export type RetryPolicy = {
  attempts: number
  backoff: {
    type: 'custom'
    delay: number
  }
}

/**
 * Exponential backoff with ±20% jitter, capped at `maxDelayMs`.
 *
 *   attempt 1 → initial
 *   attempt n → initial * 2^(n-1)   (then cap, then jitter)
 */
export function computeDelayMs(attempt: number): number {
  const { initialDelayMs, maxDelayMs } = getConfig().webhook
  const base = Math.min(
    initialDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
    maxDelayMs
  )
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.max(1000, Math.floor(base + jitter))
}

export function buildRetryPolicy(): {
  attempts: number
} {
  return {
    attempts: getConfig().webhook.maxAttempts
  }
}
