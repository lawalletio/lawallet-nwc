import { describe, it, expect } from 'vitest'
import { computeDelayMs } from '../../src/webhooks/retry-policy.js'
import { resetConfig } from '../../src/config/index.js'

describe('computeDelayMs', () => {
  it('grows approximately exponentially (base 2) within cap', () => {
    process.env.NT_WEBHOOK_INITIAL_DELAY_MS = '1000'
    process.env.NT_WEBHOOK_MAX_DELAY_MS = '3600000'
    resetConfig()

    // With ±20% jitter, attempt-1 should still be in [800, 1200]
    const samples = Array.from({ length: 20 }, () => computeDelayMs(1))
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(1000) // floor at 1000 ms
      expect(s).toBeLessThanOrEqual(1200)
    }

    const attempt4 = computeDelayMs(4) // base = 8000
    expect(attempt4).toBeGreaterThanOrEqual(6400)
    expect(attempt4).toBeLessThanOrEqual(9600)
  })

  it('respects the cap', () => {
    process.env.NT_WEBHOOK_INITIAL_DELAY_MS = '10000'
    process.env.NT_WEBHOOK_MAX_DELAY_MS = '60000'
    resetConfig()

    const veryHigh = computeDelayMs(100)
    expect(veryHigh).toBeLessThanOrEqual(72000) // cap + 20% jitter upper bound
    expect(veryHigh).toBeGreaterThanOrEqual(48000)
  })
})
