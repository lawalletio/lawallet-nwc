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

export const handleApiError = (error: unknown): NextResponse => {
  const apiError = toApiError(error)
  const responseBody = buildErrorResponse(
    apiError.message,
    apiError.code,
    apiError.details
  )

  return NextResponse.json(responseBody, { status: apiError.statusCode })
}

type RouteHandler<TResponse extends Response = Response> = (
  ...args: unknown[]
) => Promise<TResponse>

export const withErrorHandling = <TResponse extends Response>(
  handler: RouteHandler<TResponse>
) => {
  return async (...args: Parameters<RouteHandler<TResponse>>) => {
    try {
      return await handler(...args)
    } catch (error) {
      return handleApiError(error)
    }
  }
}
