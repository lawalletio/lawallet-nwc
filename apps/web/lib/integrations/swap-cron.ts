import { createLogger } from '@/lib/logger'
import { reconcilePendingSwaps } from './swaps'

const log = createLogger({ module: 'integrations:swap-cron' })

export const SWAP_CRON_INTERVAL_MS = 60_000
const FIRST_RUN_MS = 10_000

type CronState = { timer?: ReturnType<typeof setInterval>; running?: boolean }
const state = ((
  globalThis as { __lawalletSwapCron?: CronState }
).__lawalletSwapCron ??= {})

/** One pass; skipped while the previous one is still running. */
export async function swapCronTick(): Promise<void> {
  if (state.running) return
  state.running = true
  try {
    const changed = await reconcilePendingSwaps()
    if (changed > 0) log.info({ changed }, 'swap_cron.statuses_changed')
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'swap_cron.failed')
  } finally {
    state.running = false
  }
}

/**
 * In-process cron for cash-out swaps on long-running servers (Docker,
 * Umbrel, Start9, `next dev`): every minute it checks each in-flight swap
 * with its provider and updates the local status (paid, delivered, failed,
 * expired). Idempotent per process. Serverless deployments have no
 * long-lived process — there the NWC listener's swap tick does the same job;
 * when both run, `refreshSwap`'s per-swap throttle keeps the provider calls
 * from doubling up.
 */
export function startSwapCron(): void {
  if (state.timer) return
  setTimeout(() => void swapCronTick(), FIRST_RUN_MS).unref?.()
  state.timer = setInterval(() => void swapCronTick(), SWAP_CRON_INTERVAL_MS)
  state.timer.unref?.()
  log.info({ intervalMs: SWAP_CRON_INTERVAL_MS }, 'swap_cron.started')
}
