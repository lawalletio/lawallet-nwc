import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import {
  NotFoundError,
  ValidationError,
  type ApiError
} from '@/types/server/errors'
import type { RateLimitOptions } from '@/lib/middleware/rate-limit'

/** Error codes this server answers with (RFC 6749 §5.2, RFC 7591, RFC 8707). */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_target'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'

/** A protocol failure, answered as `{ error, error_description }` with 400. */
export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

/** Responses carrying credentials must never be cached (RFC 6749 §5.1). */
export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache'
} as const

/**
 * Token and revocation share one per-IP bucket, separate from everything
 * else: Claude's and ChatGPT's backends refresh for many users from the same
 * addresses, so the regular presets would throttle unrelated people.
 */
export const OAUTH_TOKEN_RATE_LIMIT: RateLimitOptions = {
  bucket: 'oauthToken',
  maxRequests: 60,
  windowMs: 60_000
}

function describeValidationError(error: ValidationError): string {
  const issue = Array.isArray(error.details)
    ? (error.details[0] as { path?: unknown[]; message?: string } | undefined)
    : undefined
  if (!issue?.message) return error.message
  const path = issue.path?.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * Answers OAuth protocol failures in RFC 6749 shape rather than the app's
 * error envelope. Schema failures become `invalid_request` unless `codeFor`
 * picks a more specific code; anything else propagates to `withErrorHandling`.
 */
export function withOAuthErrors<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
  codeFor: (error: ValidationError) => OAuthErrorCode = () => 'invalid_request'
) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      const oauthError =
        error instanceof ValidationError
          ? new OAuthError(codeFor(error), describeValidationError(error))
          : error
      if (!(oauthError instanceof OAuthError)) throw error
      return NextResponse.json(
        { error: oauthError.code, error_description: oauthError.message },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }
  }
}

/**
 * For our own consent page, which gets the app's usual error envelope: an
 * unknown client is a 404, every other protocol failure a 400.
 */
export function toAppError(error: unknown): never {
  if (!(error instanceof OAuthError)) throw error
  const appError: ApiError =
    error.code === 'invalid_client'
      ? new NotFoundError(error.message)
      : new ValidationError(error.message)
  throw appError
}

/**
 * Query or form parameters per RFC 6749 §3.1: a parameter sent without a
 * value counts as omitted, and one sent twice is an error — never "last one
 * wins", which would let the consent page and this server read different
 * values from the same URL.
 */
export function oauthParams(params: URLSearchParams): Record<string, string> {
  const seen = new Set<string>()
  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new OAuthError(
        'invalid_request',
        `Parameter "${key}" was sent more than once`
      )
    }
    seen.add(key)
  }
  return Object.fromEntries([...params].filter(([, value]) => value !== ''))
}

/** Validates OAuth parameters; failures surface as `invalid_request`. */
export function parseOAuth<T>(input: unknown, schema: ZodType<T>): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues)
  }
  return result.data
}

/**
 * Reads a token or revocation request body: `application/x-www-form-urlencoded`
 * as the RFCs require (what Claude sends), or JSON.
 */
export async function readOAuthBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.includes('application/json')) {
    return request.json().catch(() => {
      throw new OAuthError('invalid_request', 'Malformed JSON in request body')
    })
  }
  return oauthParams(new URLSearchParams(await request.text()))
}
