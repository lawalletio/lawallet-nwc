/**
 * Server-side Sentry `tracesSampler`. Matches on the transaction name
 * (`GET /api/lud16/[username]`), keeping this module Sentry-free.
 *
 * - Health/status probes and the SSE stream (`/api/events` holds a ~300s
 *   transaction per open tab) are never traced.
 * - LUD-16 and `/.well-known/*` are high-volume public lookups: 5% is plenty.
 */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.2

const NEVER = /\/api\/(health|status|events)(?:$|[/?\s])/
const LOW_VOLUME = /\/api\/lud16(?:$|[/?\s])|\/\.well-known\//

export function sampleServerTrace({ name }: { name: string }): number {
  if (NEVER.test(name)) return 0
  if (LOW_VOLUME.test(name)) return 0.05
  return DEFAULT_TRACES_SAMPLE_RATE
}
