import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Users'

const userSchema = z
  .object({
    id: z.string(),
    pubkey: z.string(),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER', 'USER']),
    createdAt: z.string().datetime(),
  })
  .passthrough()
  .openapi({ description: 'User record.' })

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/users',
  tags: [TAG],
  summary: 'List users.',
  operationId: 'users.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Users.', z.object({ data: z.array(userSchema) })),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/users/me',
  tags: [TAG],
  summary: 'Load or create the current user.',
  operationId: 'users.me',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Current user.', userSchema),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/users/{userId}',
  tags: [TAG],
  summary: 'Get a user by ID.',
  operationId: 'users.get',
  security: protectedSecurity,
  request: { params: schemas.UserIdParam },
  responses: {
    200: inlineJsonResponse('User.', userSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/users/{userId}/cards',
  tags: [TAG],
  summary: 'List cards owned by a user (self only).',
  operationId: 'users.cards.list',
  security: protectedSecurity,
  request: { params: schemas.UserIdParam },
  responses: {
    200: inlineJsonResponse(
      'User cards.',
      z.object({ data: z.array(z.object({}).passthrough()) }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'put',
  path: '/api/users/{userId}/role',
  tags: [TAG],
  summary: 'Update a user’s role.',
  operationId: 'users.role.set',
  security: protectedSecurity,
  request: {
    params: schemas.UserIdParam,
    body: {
      content: { 'application/json': { schema: schemas.UserRoleUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Role updated.', userSchema),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/users/{userId}/lightning-address',
  tags: [TAG],
  summary: 'Assign or replace a user’s lightning address (self only).',
  operationId: 'users.lightningAddress.set',
  security: protectedSecurity,
  request: {
    params: schemas.UserIdParam,
    body: {
      content: { 'application/json': { schema: schemas.LightningAddressUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse(
      'Address assigned.',
      z.object({ username: z.string() }),
    ),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'put',
  path: '/api/users/{userId}/nwc',
  tags: [TAG],
  summary: 'Store or replace a user’s NWC connection string (self only).',
  operationId: 'users.nwc.set',
  security: protectedSecurity,
  request: {
    params: schemas.UserIdParam,
    body: {
      content: { 'application/json': { schema: schemas.UserNwcUpdateRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('NWC saved.', z.object({ success: z.literal(true) })),
    ...commonErrorResponses,
    404: responses.notFound,
  },
})
