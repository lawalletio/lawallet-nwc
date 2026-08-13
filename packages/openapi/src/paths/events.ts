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
    'scheme (`token` query param) because EventSource cannot set headers. The token is ' +
    'either a session JWT (first-party apps) or a base64-encoded NIP-98 event signed by ' +
    "the user's key (cross-origin SDK clients). A NIP-98 token's `u` tag must be this " +
    'route URL without any query string (the token cannot commit to a URL containing ' +
    'itself), with method `GET`.',
  operationId: 'events.stream',
  security: [{ [EVENTS_TOKEN]: [] }],
  request: {
    query: z.object({
      token: z
        .string()
        .min(1)
        .openapi({
          description:
            'Session JWT (from POST /api/jwt) or base64-encoded NIP-98 event ' +
            'whose `u` tag is the /api/events URL without query string.'
        })
    })
  },
  responses: {
    200: {
      description: 'SSE stream of `data: <json>\\n\\n` frames.',
      content: {
        'text/event-stream': {
          schema: z.string().openapi({
            description: 'Raw SSE frames; not JSON. See `EventSource` API.'
          })
        }
      }
    },
    401: responses.unauthenticated,
    500: responses.internalError
  }
})
