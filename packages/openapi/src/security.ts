import { registry } from './registry'

// Two auth schemes are registered to mirror lib/auth/unified-auth.ts:
//   - Bearer JWT          (Authorization: Bearer <jwt>)
//   - NIP-98 Nostr event  (Authorization: Nostr <base64-event>)
// The NIP-98 scheme is modeled as an apiKey-in-header because OpenAPI 3.x
// has no first-class scheme for "Nostr <base64>" and the http/bearer scheme
// is reserved for the JWT flow.

export const BEARER_JWT = 'BearerJWT'
export const NIP98 = 'NIP98'
export const EVENTS_TOKEN = 'EventsToken'
export const LISTENER_HMAC = 'ListenerHmac'

registry.registerComponent('securitySchemes', BEARER_JWT, {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Session JWT obtained from POST /api/jwt.'
})

registry.registerComponent('securitySchemes', NIP98, {
  type: 'apiKey',
  in: 'header',
  name: 'Authorization',
  description:
    'NIP-98 signed event, base64-encoded, prefixed with `Nostr ` (e.g. `Authorization: Nostr <base64>`).'
})

// /api/events accepts the JWT through a query string parameter because
// EventSource cannot set custom headers. Documenting it as a separate scheme
// keeps the spec honest about how SSE clients must authenticate.
registry.registerComponent('securitySchemes', EVENTS_TOKEN, {
  type: 'apiKey',
  in: 'query',
  name: 'token',
  description: 'JWT passed as a query string parameter for SSE clients.'
})

registry.registerComponent('securitySchemes', LISTENER_HMAC, {
  type: 'apiKey',
  in: 'header',
  name: 'x-lawallet-signature',
  description:
    'Listener-only HMAC signature: `sha256=<hex HMAC-SHA256(secret, `${x-lawallet-timestamp}.${rawBody}`)>`. The request must also include the current Unix-millisecond `x-lawallet-timestamp` header.'
})
