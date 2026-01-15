import { NextResponse } from 'next/server'

import { buildErrorResponse } from './api-response'
import { ApiError, InternalServerError } from './errors'

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
  options?: { headers?: HeadersInit }
) => {
  return async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (error) {
      return handleApiError(error, options?.headers)
    }
  }
}
