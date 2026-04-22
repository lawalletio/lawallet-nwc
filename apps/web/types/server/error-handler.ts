import { NextResponse } from 'next/server'

import { buildErrorResponse } from './api-response'
import { ApiError, InternalServerError, TooManyRequestsError } from './errors'
import { withRequestLogging } from '@/lib/logger'
import { logger } from '@/lib/logger'
import { checkMaintenance } from '@/lib/middleware/maintenance'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import type { ActivityCategory, ActivityLevel } from '@/lib/generated/prisma'
import { Prisma } from '@/lib/generated/prisma'

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error
  }

  if (error instanceof Error) {
    return new InternalServerError(error.message, { cause: error })
  }

  return new InternalServerError('Unexpected error')
}

// Skip these 4xx codes in the activity log — they're normal client behavior
// (expired tokens, 404s on poll endpoints, rate limits) and would swamp the
// admin UI with noise.
const QUIET_CLIENT_ERRORS = new Set([401, 403, 404, 429])

function inferCategoryFromPath(pathname: string | undefined): ActivityCategory {
  if (!pathname) return 'SERVER'
  if (pathname.startsWith('/api/invoices')) return 'INVOICE'
  if (pathname.startsWith('/api/cards') || pathname.startsWith('/api/card-designs')) return 'CARD'
  if (pathname.startsWith('/api/wallet/addresses') || pathname.includes('/lightning-address')) return 'ADDRESS'
  if (pathname.startsWith('/api/wallet/nwc-connections') || pathname.includes('/nwc')) return 'NWC'
  if (
    pathname.startsWith('/api/users') ||
    pathname.startsWith('/api/jwt') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/root')
  ) return 'USER'
  return 'SERVER'
}

function eventCodeForError(category: ActivityCategory, isServerError: boolean, isDbError: boolean): string {
  if (isDbError) return ActivityEvent.SERVER_DATABASE_ERROR
  if (isServerError) return ActivityEvent.SERVER_UNHANDLED_ERROR
  switch (category) {
    case 'USER': return ActivityEvent.USER_ERROR
    case 'ADDRESS': return ActivityEvent.ADDRESS_ERROR
    case 'CARD': return ActivityEvent.CARD_ERROR
    case 'NWC': return ActivityEvent.NWC_CONNECTION_ERROR
    case 'INVOICE': return ActivityEvent.INVOICE_GENERATION_FAILED
    default: return ActivityEvent.SERVER_UNHANDLED_ERROR
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

  // Log errors with context
  logger.error(
    {
      err: apiError,
      statusCode: apiError.statusCode,
      code: apiError.code,
      details: apiError.details
    },
    'api.error'
  )

  // Mirror qualifying errors into the ActivityLog audit trail.
  const statusCode = apiError.statusCode
  const shouldLog = statusCode >= 500 || (statusCode >= 400 && !QUIET_CLIENT_ERRORS.has(statusCode))
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
    const pathname = request instanceof Request ? safePathname(request.url) : undefined
    logActivity.fireAndForget({
      category,
      event: eventCodeForError(category, isServerError, isDbError),
      level,
      message: `${method ?? 'REQUEST'} ${pathname ?? '?'} failed: ${apiError.message}`,
      metadata: {
        statusCode,
        code: apiError.code,
        method,
        pathname,
      },
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
