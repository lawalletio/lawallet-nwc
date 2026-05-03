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

const TAG = 'Invoices'

const invoiceSchema = z
  .object({
    id: z.string(),
    purpose: z.enum(['registration', 'wallet-address']),
    pr: z.string(),
    paymentHash: z.string(),
    settled: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .passthrough()
  .openapi({ description: 'Pay-then-act invoice for registration flows.' })

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/invoices',
  tags: [TAG],
  summary: 'Create a registration / wallet-address invoice.',
  operationId: 'invoices.create',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.InvoiceCreateRequest } },
    },
  },
  responses: {
    201: inlineJsonResponse('Invoice created.', invoiceSchema),
    ...commonErrorResponses,
  },
})

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/invoices/{id}/claim',
  tags: [TAG],
  summary: 'Claim a paid invoice with the BOLT11 preimage.',
  operationId: 'invoices.claim',
  security: protectedSecurity,
  request: {
    params: schemas.IdParam,
    body: {
      content: { 'application/json': { schema: schemas.InvoiceClaimRequest } },
    },
  },
  responses: {
    200: inlineJsonResponse('Invoice claimed.', invoiceSchema),
    ...commonErrorResponses,
    404: responses.notFound,
    409: responses.conflict,
  },
})
