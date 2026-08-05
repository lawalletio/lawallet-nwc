import pino, { type Logger } from 'pino'
import type { ListenerEnv } from './env'
import { createLogThrottle } from './process-errors'

let root: Logger | null = null

/**
 * Builds the root pino logger. Same output conventions as apps/web
 * (iso timestamps, `err` serializer, pino-pretty when LOG_PRETTY) minus the
 * per-request AsyncLocalStorage machinery — this is a daemon, not a router.
 */
export function initLogger(env: ListenerEnv): Logger {
  root = pino({
    level: env.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'lawallet-listener',
      env: env.NODE_ENV
    },
    serializers: {
      err: pino.stdSerializers.err
    },
    transport: env.LOG_PRETTY
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  })
  return root
}

/**
 * Child logger pre-tagged with `context` (e.g. `{ module: 'pool' }`).
 * Falls back to a default-initialized root when initLogger hasn't run
 * (only happens in tests).
 */
export function createLogger(context?: Record<string, unknown>): Logger {
  const base = root ?? pino({ level: 'silent' })
  return context ? base.child(context) : base
}

/**
 * Routes console.* through pino. @getalby/sdk's internal resubscribe loop
 * logs via console.info/console.error — this turns that noise into
 * structured log lines instead of raw stdout.
 */
export function patchConsole(logger: Logger): void {
  const sdkLog = logger.child({ module: 'console' })
  const take = createLogThrottle({ windowMs: 30_000, maxTracked: 50 })

  const emit = (level: 'info' | 'warn' | 'error', args: unknown[]): void => {
    const message = String(args[0])
    const suppressed = take(`${level}:${message}`)
    if (suppressed === null) return
    sdkLog[level]({ args: args.slice(1), suppressed }, message)
  }

  console.log = (...args: unknown[]) => emit('info', args)
  console.info = (...args: unknown[]) => emit('info', args)
  console.warn = (...args: unknown[]) => emit('warn', args)
  console.error = (...args: unknown[]) => emit('error', args)
}
