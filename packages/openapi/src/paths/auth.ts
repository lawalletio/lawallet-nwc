import { z } from 'zod'
import { inlineJsonResponse, jsonResponse, protectedSecurity, withRole } from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'
import { NIP98 } from '../security'

const TAG = 'Auth'

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/jwt',
  tags: [TAG],
  summary: 'Get JWT via NIP-98 auth',
  operationId: 'auth.exchange',
  // The exchange endpoint requires NIP-98 — it's the very flow that mints the
  // JWT, so we override the global default to pin it to NIP-98 only.
  security: [{ [NIP98]: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: schemas.JwtRequest } },
    },
  },
  responses: {
    200: jsonResponse('JWT issued.', 'JwtResponse'),
    400: responses.validation,
    401: responses.unauthenticated,
    500: responses.internalError,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/jwt',
  tags: [TAG],
  summary: 'Validate JWT',
  operationId: 'auth.validate',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Token is valid.',
      z.object({
        valid: z.literal(true),
        pubkey: z.string().optional(),
        role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER']).optional(),
        expiresAt: z.string().datetime().optional(),
      }),
    ),
    401: responses.unauthenticated,
    500: responses.internalError,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/jwt/protected',
  tags: [TAG],
  summary: 'Demo route guarded by the unified auth chain.',
  operationId: 'auth.protected.get',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Caller is authenticated.',
      z.object({ ok: z.literal(true), pubkey: z.string().optional() }),
    ),
    401: responses.unauthenticated,
    500: responses.internalError,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/jwt/protected',
  tags: [TAG],
  summary: 'Demo POST guarded by the unified auth chain.',
  operationId: 'auth.protected.post',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Caller is authenticated.', z.object({ ok: z.literal(true) })),
    401: responses.unauthenticated,
    500: responses.internalError,
  },
})
