/**
 * In-memory counters surfaced on GET /status. Reset on process restart —
 * durable history lives in listener.processed_events, not here.
 */
export const metrics = {
  startedAt: new Date(),
  eventsReceived: 0,
  eventsDuplicate: 0,
  webhooksDelivered: 0,
  webhooksFailed: 0,
  /** Currently-undelivered webhooks (gauge, refreshed by the sweep). */
  webhooksPending: 0,
  nwcRequests: 0,
  nwcRequestErrors: 0,
  /** Unique idempotent card-payment operations accepted by the listener. */
  nwcPayments: 0,
  /** Repeated request ids joined to an in-flight or durable operation. */
  nwcPaymentDuplicates: 0,
  /** Foreground SDK payment operations whose result is not known yet. */
  nwcPaymentsPending: 0,
  reconciles: 0,
  notifiesReceived: 0,
  eventsRecovered: 0,
  catchupRuns: 0,
  catchupErrors: 0,
  deadProbesRun: 0,
  deadProbesTimedOut: 0,
  walletsDeclaredDead: 0
}

export type Metrics = typeof metrics
