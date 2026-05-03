import { z } from 'zod'
import { withRole } from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { EVENTS_TOKEN } from '../security'

const TAG = 'Events'

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/events',
  tags: [TAG],
  summary: 'Server-Sent Events stream for live updates.',
  description:
    'Long-lived `text/event-stream` connection. Authentication uses the EventsToken ' +
    'scheme (JWT in the `token` query param) because EventSource cannot set headers.',
  operationId: 'events.stream',
  security: [{ [EVENTS_TOKEN]: [] }],
  request: {
    query: z.object({
      token: z.string().min(1).openapi({ description: 'JWT, normally obtained from POST /api/jwt.' }),
    }),
  },
  responses: {
    200: {
      description: 'SSE stream of `data: <json>\\n\\n` frames.',
      content: {
        'text/event-stream': {
          schema: z
            .string()
            .openapi({ description: 'Raw SSE frames; not JSON. See `EventSource` API.' }),
        },
      },
    },
    401: responses.unauthenticated,
    500: responses.internalError,
  },
})
