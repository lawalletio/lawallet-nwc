import type { Logger } from 'pino'
import type { ListenerEnv } from './env'
import { requestBacklogTick, type ZapSettleOutcome } from './zap-settle'

/**
 * Cron for cash-out swaps (Wapu / Bull Bitcoin). Web asks each provider for
 * the status of every swap still in flight, persists it and pushes the change
 * over SSE; the listener only owns the timer, since web has no scheduler of
 * its own on serverless. Scheduled with the same backlog-aware
 * `ZapSettleScheduler`: fast while web reports swaps in flight, backing off
 * while it reports none.
 */
export function requestSwapReconcile(
  env: ListenerEnv,
  log: Logger
): Promise<ZapSettleOutcome> {
  return requestBacklogTick(
    env,
    log,
    '/api/internal/swaps/reconcile',
    'swap_reconcile'
  )
}
