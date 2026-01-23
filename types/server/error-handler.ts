import { NextResponse } from 'next/server'

import { buildErrorResponse } from './api-response'
import { ApiError, InternalServerError } from './errors'
import { withRequestLogging } from '@/lib/logger'
import { logger } from '@/lib/logger'

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error
  }

  if (error instanceof Error) {
    return new InternalServerError(error.message, { cause: error })
  }

  return new InternalServerError('Unexpected error')
}

export const handleApiError = (
  error: unknown,
  headers?: HeadersInit
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

  return NextResponse.json(responseBody, {
    status: apiError.statusCode,
    headers
  })
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
    try {
      return await loggedHandler(...args)
    } catch (error) {
      return handleApiError(error, options?.headers)
    }
  }
}
