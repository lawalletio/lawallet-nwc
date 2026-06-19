import { z } from 'zod'
import { registry } from './registry'

// Mirrors `buildErrorResponse()` in apps/web/types/server/api-response.ts
// and the ApiError class hierarchy in apps/web/types/server/errors.ts.
// Re-declared here (rather than imported) so the openapi package stays free
// of any web-app dependency.

export const ErrorEnvelope = registry.register(
  'ErrorEnvelope',
  z
    .object({
      success: z.literal(false),
      error: z.object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
      }),
    })
    .openapi({
      description:
        'Standard error envelope returned by every route via `withErrorHandling`.',
    }),
)

/**
 * Builds an error-envelope response with a custom description. Exported so a
 * route can document a status code with endpoint-specific wording (e.g. *why*
 * a 409 happens) instead of the generic shared `responses.*` entries.
 */
export const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelope' as const },
    },
  },
})

export const responses = {
  validation: errorResponse('Request payload failed Zod validation.'),
  unauthenticated: errorResponse('Missing or invalid authentication.'),
  forbidden: errorResponse('Caller is authenticated but lacks the required role or permission.'),
  notFound: errorResponse('Resource not found.'),
  conflict: errorResponse('Request conflicts with current resource state.'),
  payloadTooLarge: errorResponse('Request body exceeds the configured limit.'),
  rateLimited: errorResponse('Rate limit exceeded; check the Retry-After header.'),
  serviceUnavailable: errorResponse('Upstream service unavailable or maintenance mode active.'),
  internalError: errorResponse('Unhandled server error.'),
}
