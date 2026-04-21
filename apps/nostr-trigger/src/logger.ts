import pino, { type Logger } from 'pino'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { getConfig } from './config/index.js'

type RequestContext = {
  reqId: string
}

const requestContext = new AsyncLocalStorage<RequestContext>()

let cachedLogger: Logger | null = null

function build(): Logger {
  const config = getConfig()
  return pino({
    level: config.log.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'nostr-trigger',
      env: config.env
    },
    serializers: { err: pino.stdSerializers.err },
    mixin() {
      const reqId = requestContext.getStore()?.reqId
      return reqId ? { reqId } : {}
    },
    transport: config.log.pretty
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
}

export function logger(): Logger {
  if (!cachedLogger) cachedLogger = build()
  return cachedLogger
}

export function resetLogger(): void {
  cachedLogger = null
}

export function withRequestId<T>(reqId: string, fn: () => T): T {
  return requestContext.run({ reqId }, fn)
}

export function getOrCreateRequestId(headers?: Headers): string {
  const fromHeader =
    headers?.get('x-request-id')?.trim() ||
    headers?.get('x-correlation-id')?.trim()
  if (fromHeader && fromHeader.length <= 200) return fromHeader
  return randomUUID()
}

export function createChildLogger(
  context?: Record<string, unknown>
): Logger {
  return context ? logger().child(context) : logger()
}
