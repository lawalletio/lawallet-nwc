/**
 * Wrap an async operation in a timing span tied to the current request.
 *
 * Emits `{ reqId, span, durationMs, ok }` at debug on success and warn on
 * failure, so a single `reqId` (echoed on the `x-request-id` response
 * header) shows a per-step breakdown of multi-hop flows like
 * card scan → NWC call → invoice.
 *
 * Field names are OpenTelemetry-friendly on purpose — if real tracing lands
 * later, call sites don't change shape. No dependency, ~zero overhead.
 *
 * The logger is loaded lazily: `@/lib/logger` reads config at module load,
 * and modules wrapped in spans (e.g. wallet drivers) are imported by unit
 * tests that don't mock config. Lazy loading keeps those imports
 * side-effect-free.
 */

type SpanLogger = {
  debug: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
}

let depsPromise: Promise<{
  log: SpanLogger | null
  getCurrentReqId: () => string | undefined
}> | null = null

function deps() {
  // Best-effort: spans must never break the operation they wrap, including
  // under tests that mock @/lib/logger with a partial module.
  depsPromise ??= import('@/lib/logger')
    .then(m => ({
      log:
        typeof m.createLogger === 'function'
          ? (m.createLogger({ module: 'timing' }) as SpanLogger)
          : null,
      getCurrentReqId:
        typeof m.getCurrentReqId === 'function'
          ? m.getCurrentReqId
          : () => undefined
    }))
    .catch(() => ({
      log: null,
      getCurrentReqId: () => undefined as string | undefined
    }))
  return depsPromise
}

export async function withSpan<T>(
  span: string,
  fn: () => Promise<T>
): Promise<T> {
  const { log, getCurrentReqId } = await deps()
  const start = performance.now()

  try {
    const result = await fn()
    log?.debug(
      {
        reqId: getCurrentReqId(),
        span,
        durationMs: Math.round(performance.now() - start),
        ok: true
      },
      'span.end'
    )
    return result
  } catch (err) {
    log?.warn(
      {
        reqId: getCurrentReqId(),
        span,
        durationMs: Math.round(performance.now() - start),
        ok: false
      },
      'span.end'
    )
    throw err
  }
}
