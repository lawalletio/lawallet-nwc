import { afterEach, describe, expect, it, vi } from 'vitest'

const reconcile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/integrations/swaps', () => ({
  reconcilePendingSwaps: reconcile
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() })
}))

import {
  SWAP_CRON_INTERVAL_MS,
  startSwapCron,
  swapCronTick
} from '@/lib/integrations/swap-cron'

afterEach(() => vi.useRealTimers())

describe('swap cron', () => {
  it('never runs two passes at once and survives a failing pass', async () => {
    let finish!: () => void
    reconcile.mockImplementationOnce(
      () => new Promise<number>(r => (finish = () => r(1)))
    )
    const first = swapCronTick()
    await swapCronTick() // overlaps: skipped
    expect(reconcile).toHaveBeenCalledTimes(1)
    finish()
    await first
    reconcile.mockRejectedValueOnce(new Error('db down'))
    await expect(swapCronTick()).resolves.toBeUndefined()
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('starts once per process and ticks every minute', async () => {
    vi.useFakeTimers()
    reconcile.mockReset().mockResolvedValue(0)
    startSwapCron()
    startSwapCron() // idempotent
    await vi.advanceTimersByTimeAsync(SWAP_CRON_INTERVAL_MS * 2)
    // First run after 10s, then once per interval.
    expect(reconcile).toHaveBeenCalledTimes(3)
  })
})
