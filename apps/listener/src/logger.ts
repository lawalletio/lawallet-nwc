import pino, { type Logger } from 'pino'
import type { ListenerEnv } from './env'

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
  console.log = (...args: unknown[]) =>
    sdkLog.info({ args: args.slice(1) }, String(args[0]))
  console.info = (...args: unknown[]) =>
    sdkLog.info({ args: args.slice(1) }, String(args[0]))
  console.warn = (...args: unknown[]) =>
    sdkLog.warn({ args: args.slice(1) }, String(args[0]))
  console.error = (...args: unknown[]) =>
    sdkLog.error({ args: args.slice(1) }, String(args[0]))
}
