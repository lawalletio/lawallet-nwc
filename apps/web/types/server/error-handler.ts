import { NextResponse } from 'next/server'

import { buildErrorResponse } from './api-response'
import {
  ApiError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError
} from './errors'
import { getCurrentReqId, withRequestLogging } from '@/lib/logger'
import { logger } from '@/lib/logger'
import { checkMaintenance } from '@/lib/middleware/maintenance'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import type { ActivityCategory, ActivityLevel } from '@/lib/generated/prisma'
import { Prisma } from '@/lib/generated/prisma'

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error
  }

  // Prisma error messages embed schema and query details — never serialize
  // them to clients. Map the well-known codes to proper status codes and keep
  // the original error as `cause` for logs/Sentry.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictError('A record with this value already exists')
    }
    if (error.code === 'P2025') {
      return new NotFoundError('Record not found')
    }
    return new InternalServerError('Database error', { cause: error })
  }
  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new InternalServerError('Database error', { cause: error })
  }

  if (error instanceof Error) {
    // Fixed message: a plain Error's text describes internals (library
    // messages, file paths, SQL) and must not reach the client.
    return new InternalServerError('Internal server error', { cause: error })
  }

  return new InternalServerError('Unexpected error')
}

// Skip these 4xx codes in the activity log — they're normal client behavior
// (expired tokens, 404s on poll endpoints, rate limits) and would swamp the
// admin UI with noise. 413 is here because oversized bodies are rejected
// BEFORE authentication on the webhook path: logging them would turn the
// memory-exhaustion fix into a DB-write amplification vector.
const QUIET_CLIENT_ERRORS = new Set([401, 403, 404, 413, 429])

function inferCategoryFromPath(pathname: string | undefined): ActivityCategory {
  if (!pathname) return 'SERVER'
  if (pathname.startsWith('/api/invoices')) return 'INVOICE'
  if (
    pathname.startsWith('/api/cards') ||
    pathname.startsWith('/api/card-designs')
  )
    return 'CARD'
  if (
    pathname.startsWith('/api/wallet/addresses') ||
    pathname.includes('/lightning-address')
  )
    return 'ADDRESS'
  if (
    pathname.startsWith('/api/wallet/nwc-connections') ||
    pathname.includes('/nwc')
  )
    return 'NWC'
  if (
    pathname.startsWith('/api/users') ||
    pathname.startsWith('/api/jwt') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/root')
  )
    return 'USER'
  return 'SERVER'
}

function eventCodeForError(
  category: ActivityCategory,
  isServerError: boolean,
  isDbError: boolean
): string {
  if (isDbError) return ActivityEvent.SERVER_DATABASE_ERROR
  if (isServerError) return ActivityEvent.SERVER_UNHANDLED_ERROR
  switch (category) {
    case 'USER':
      return ActivityEvent.USER_ERROR
    case 'ADDRESS':
      return ActivityEvent.ADDRESS_ERROR
    case 'CARD':
      return ActivityEvent.CARD_ERROR
    case 'NWC':
      return ActivityEvent.NWC_CONNECTION_ERROR
    case 'INVOICE':
      return ActivityEvent.INVOICE_GENERATION_FAILED
    default:
      return ActivityEvent.SERVER_UNHANDLED_ERROR
  }
}

export const handleApiError = (
  error: unknown,
  headers?: HeadersInit,
  request?: Request
): NextResponse => {
  const apiError = toApiError(error)
  const responseBody = buildErrorResponse(
    apiError.message,
    apiError.code,
    apiError.details
  )

  // Log errors with context. When the original error was mapped to a
  // sanitized ApiError (e.g. Prisma P2002 → 409), keep its name/message for
  // server-side debugging — the client only ever sees the sanitized shape.
  logger.error(
    {
      err: apiError,
      originalError:
        error instanceof Error && !(error instanceof ApiError)
          ? { name: error.name, message: error.message }
          : undefined,
      statusCode: apiError.statusCode,
      code: apiError.code,
      details: apiError.details
    },
    'api.error'
  )

  // Forward 5xx to Sentry when configured. withErrorHandling swallows the
  // throw (Next's onRequestError never fires for these routes), so this is
  // THE server capture seam. Fire-and-forget: a Sentry failure must never
  // change the response. Maintenance 503s are expected, not errors.
  if (
    apiError.statusCode >= 500 &&
    process.env.SENTRY_DSN &&
    !(apiError instanceof ServiceUnavailableError)
  ) {
    try {
      import('@sentry/nextjs')
        .then(Sentry =>
          // Capture the original error when available for better grouping.
          Sentry.captureException(apiError.cause ?? apiError, {
            tags: {
              reqId: getCurrentReqId(),
              code: apiError.code,
              path:
                request instanceof Request
                  ? safePathname(request.url)
                  : undefined
            }
          })
        )
        .catch(() => {})
    } catch {
      // ignore — observability must not affect the request path
    }
  }

  // Mirror qualifying errors into the ActivityLog audit trail.
  const statusCode = apiError.statusCode
  const shouldLog =
    statusCode >= 500 ||
    (statusCode >= 400 && !QUIET_CLIENT_ERRORS.has(statusCode))
  if (shouldLog) {
    const isServerError = statusCode >= 500
    const isDbError =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError
    const category: ActivityCategory = isDbError
      ? 'SERVER'
      : inferCategoryFromPath(
          request instanceof Request ? safePathname(request.url) : undefined
        )
    const level: ActivityLevel = isServerError ? 'ERROR' : 'WARN'
    const method = request instanceof Request ? request.method : undefined
    const pathname =
      request instanceof Request ? safePathname(request.url) : undefined
    logActivity.fireAndForget({
      category,
      event: eventCodeForError(category, isServerError, isDbError),
      level,
      message: `${method ?? 'REQUEST'} ${pathname ?? '?'} failed: ${apiError.message}`,
      metadata: {
        statusCode,
        code: apiError.code,
        method,
        pathname
      }
    })
  }

  // Build response headers
  const responseHeaders = new Headers(headers)

  // Add Retry-After header for rate limit errors
  if (apiError instanceof TooManyRequestsError) {
    responseHeaders.set('Retry-After', apiError.retryAfter.toString())
  }

  return NextResponse.json(responseBody, {
    status: apiError.statusCode,
    headers: responseHeaders
  })
}

function safePathname(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

type RouteHandler<
  TResponse extends Response = Response,
  TArgs extends unknown[] = unknown[]
> = (...args: TArgs) => Promise<TResponse>

export const withErrorHandling = <
  TResponse extends Response,
  TArgs extends unknown[] = unknown[]
>(
  handler: RouteHandler<TResponse, TArgs>,
  options?: { headers?: HeadersInit; slowRequestThreshold?: number }
) => {
  // Wrap handler with request logging first, then error handling
  const loggedHandler = withRequestLogging(handler as any) as RouteHandler<
    TResponse,
    TArgs
  >

  return async (...args: TArgs) => {
    const request = args[0]
    try {
      if (request instanceof Request) {
        await checkMaintenance(request)
      }
      return await loggedHandler(...args)
    } catch (error) {
      return handleApiError(
        error,
        options?.headers,
        request instanceof Request ? request : undefined
      )
    }
  }
}
