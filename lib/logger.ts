import pino, { type Logger } from 'pino'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { getConfig } from '@/lib/config'

export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent'

type RequestContext = {
  reqId: string
}

const requestContext = new AsyncLocalStorage<RequestContext>()

function asLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined
  const v = value.toLowerCase()
  const allowed: LogLevel[] = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent'
  ]
  return allowed.includes(v as LogLevel) ? (v as LogLevel) : undefined
}

function getDefaultLogLevel(): LogLevel {
  const fromEnv = asLogLevel(process.env.LOG_LEVEL)
  if (fromEnv) return fromEnv
  return getConfig().isProduction ? 'info' : 'debug'
}

function isPrettyEnabled(): boolean {
  // Acceptance criteria: JSON in production, pretty in dev
  return getConfig().logPretty
}

function getReqIdFromContext(): string | undefined {
  return requestContext.getStore()?.reqId
}

function reqSummary(req: unknown): {
  method?: string
  path?: string
  userAgent?: string
  ip?: string
} {
  const r = req as any
  const method: string | undefined =
    typeof r?.method === 'string' ? r.method : undefined

  let path: string | undefined
  if (typeof r?.url === 'string') {
    try {
      path = new URL(r.url).pathname
    } catch {
      path = undefined
    }
  }

  const headers = r?.headers
  const userAgent: string | undefined =
    typeof headers?.get === 'function'
      ? (headers.get('user-agent') ?? undefined)
      : undefined
  const forwardedFor: string | undefined =
    typeof headers?.get === 'function'
      ? (headers.get('x-forwarded-for') ?? undefined)
      : undefined
  const ip = forwardedFor?.split(',')[0]?.trim() || undefined

  return { method, path, userAgent, ip }
}

function trySetResponseHeader(res: unknown, name: string, value: string) {
  const r = res as any
  try {
    if (r?.headers && typeof r.headers.set === 'function') {
      r.headers.set(name, value)
    }
  } catch {
    // best-effort
  }
}

export function getOrCreateRequestId(headers?: Headers): string {
  const fromHeader =
    headers?.get('x-request-id')?.trim() ||
    headers?.get('x-correlation-id')?.trim() ||
    headers?.get('x-amzn-trace-id')?.trim()

  if (fromHeader && fromHeader.length <= 200) return fromHeader
  return randomUUID()
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn)
}

export const logger: Logger = pino({
  level: getDefaultLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: process.env.SERVICE_NAME || 'lawallet-nwc',
    env: process.env.NODE_ENV || 'development'
  },
  serializers: {
    err: pino.stdSerializers.err
  },
  mixin() {
    const reqId = getReqIdFromContext()
    return reqId ? { reqId } : {}
  },
  transport: isPrettyEnabled()
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

export function createLogger(context?: Record<string, unknown>) {
  return context ? logger.child(context) : logger
}

export function logError(err: unknown, context?: Record<string, unknown>) {
  logger.error({ err, ...context }, 'error')
}

/**
 * Wrap a Next.js App Router `app/api/<route>/route.ts` handler with:
 * - correlation/request IDs (`reqId`) via AsyncLocalStorage (auto-included in all logs)
 * - request start/end logs + duration
 * - error logs including stack traces
 *
 * Usage:
 *   export const GET = withRequestLogging(async (req) => { ... })
 */
export function withRequestLogging<
  THandler extends (...args: any[]) => Response | Promise<Response>
>(handler: THandler): THandler {
  return (async (...args: any[]) => {
    const req = args[0] as any
    const headers: Headers | undefined = req?.headers
    const reqId = getOrCreateRequestId(headers)
    const startedAt = Date.now()

    return await runWithRequestContext({ reqId }, async () => {
      const log = logger.child({ req: reqSummary(req) })
      log.info({ req: reqSummary(req) }, 'request.start')

      try {
        const res = await handler(...args)
        const durationMs = Date.now() - startedAt

        trySetResponseHeader(res, 'x-request-id', reqId)

        log.info(
          { res: { status: (res as any)?.status }, durationMs },
          'request.end'
        )
        return res
      } catch (err) {
        const durationMs = Date.now() - startedAt
        log.error({ err, durationMs }, 'request.error')
        throw err
      }
    })
  }) as THandler
}
