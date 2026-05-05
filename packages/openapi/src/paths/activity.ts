import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'

const TAG = 'Activity'

const activityEntrySchema = z
  .object({
    id: z.string(),
    category: z.string(),
    actor: z.string().nullable().optional(),
    target: z.string().nullable().optional(),
    timestamp: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi({ description: 'Single activity log entry.' })

registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/activity',
  tags: [TAG],
  summary: 'Read the activity log.',
  operationId: 'activity.list',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Activity entries.',
      z.object({ data: z.array(activityEntrySchema) }),
    ),
    ...commonErrorResponses,
  },
})
