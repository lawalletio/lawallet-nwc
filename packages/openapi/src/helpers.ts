import { z } from 'zod'
import { responses } from './responses'
import { BEARER_JWT, NIP98 } from './security'

// `x-required-role` is a custom OpenAPI extension consumed by the docs UI to
// show a role badge on each operation. The values mirror lib/auth/permissions.ts:
// USER < VIEWER < OPERATOR < ADMIN, plus PUBLIC for routes with no auth at all.
export type RequiredRole = 'PUBLIC' | 'USER' | 'VIEWER' | 'OPERATOR' | 'ADMIN'

/**
 * Spread into a `registry.registerPath` call to attach the role badge:
 *
 *     registry.registerPath({
 *       ...withRole('ADMIN'),
 *       method: 'post',
 *       path: '/api/cards',
 *       ...
 *     })
 */
export function withRole(role: RequiredRole): { 'x-required-role': RequiredRole } {
  return { 'x-required-role': role }
}

// OpenAPI 3.x SecurityRequirementObject. Re-declared here to avoid a runtime
// dep on the openapi3-ts package — the openapi-types package isn't installed.
type SecurityRequirement = Record<string, string[]>

// Apply both JWT and NIP-98 schemes; the route handler accepts either.
export const protectedSecurity: SecurityRequirement[] = [
  { [BEARER_JWT]: [] },
  { [NIP98]: [] },
]

// Empty array = explicitly public. Required for routes that override the
// global default in document.ts.
export const publicSecurity: SecurityRequirement[] = []

export const jsonContent = (schemaRef: string) => ({
  'application/json': {
    schema: { $ref: `#/components/schemas/${schemaRef}` as const },
  },
})

export const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: jsonContent(schemaRef),
})

// Generic ad-hoc JSON body when there is no registered component schema.
// Lets routes whose response shape we haven't modeled in detail still appear
// in the spec without lying about their structure.
export const inlineJsonResponse = (description: string, schema: z.ZodTypeAny) => ({
  description,
  content: { 'application/json': { schema } },
})

export const noContent = (description = 'No content.') => ({ description })

export const commonErrorResponses = {
  400: responses.validation,
  401: responses.unauthenticated,
  403: responses.forbidden,
  500: responses.internalError,
}

export const publicErrorResponses = {
  400: responses.validation,
  500: responses.internalError,
}
