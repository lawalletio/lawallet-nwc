import { enabledPlugins } from './loader'
import type { PluginHookName, PluginHookPayloads } from './types'

/**
 * Dispatch a lifecycle hook to every enabled plugin that subscribes to it.
 *
 * Fire-and-forget semantics by design: a plugin throwing must NEVER break
 * the business operation that emitted the hook (an invoice is paid whether
 * or not a badge gets awarded). Failures are logged with the plugin id.
 *
 * This is a server-side handler dispatcher — distinct from
 * `lib/events/event-bus.ts`, which broadcasts SSE frames to connected
 * browser clients. Emit sites typically call both.
 *
 * The logger loads lazily and fault-tolerantly (same rationale as
 * `lib/observability/timing.ts`): emit sites are imported by tests that
 * partially mock `@/lib/logger`, and logging failures must never surface.
 */

type HookLogger = { warn: (obj: object, msg: string) => void }

let logPromise: Promise<HookLogger | null> | null = null

function getLog() {
  logPromise ??= import('@/lib/logger')
    .then(m =>
      typeof m.createLogger === 'function'
        ? (m.createLogger({ module: 'plugins' }) as HookLogger)
        : null
    )
    .catch(() => null)
  return logPromise
}

export async function dispatchHook<N extends PluginHookName>(
  name: N,
  payload: PluginHookPayloads[N]
): Promise<void> {
  const log = await getLog()

  let plugins
  try {
    plugins = await enabledPlugins()
  } catch (err) {
    log?.warn({ hook: name, err }, 'plugins.dispatch_failed')
    return
  }

  await Promise.all(
    plugins.map(async plugin => {
      const handler = plugin.hooks?.[name]
      if (!handler) return
      try {
        await handler(payload)
      } catch (err) {
        log?.warn(
          { hook: name, pluginId: plugin.id, err },
          'plugins.hook_failed'
        )
      }
    })
  )
}

/** Convenience for emit sites that must not await plugin work. */
export function dispatchHookAndForget<N extends PluginHookName>(
  name: N,
  payload: PluginHookPayloads[N]
): void {
  void dispatchHook(name, payload)
}
