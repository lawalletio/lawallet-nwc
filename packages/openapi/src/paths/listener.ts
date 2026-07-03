import { listenerStatusProxyResponseSchema } from '@lawallet-nwc/shared'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole,
} from '../helpers'
import { registry } from '../registry'

const TAG = 'Listener'

// Only the RBAC-gated status proxy is public API surface. The listener's own
// HTTP endpoints (/status, /nwc/request) and the POST /api/webhooks/nwc
// HMAC webhook are internal machine-to-machine contracts — documented in
// docs/services/NWC-LISTENER.md, deliberately absent from this spec.
registry.registerPath({
  ...withRole('VIEWER'),
  method: 'get',
  path: '/api/admin/listener/status',
  tags: [TAG],
  summary: 'Live status of the NWC listener service.',
  description:
    'Proxies the listener relay-pool status (active NWC connections, relays, ' +
    'recent events, counters). Returns `state: "disabled"` when the optional ' +
    'listener service is not configured, `state: "unreachable"` when it is ' +
    'configured but not answering.',
  operationId: 'admin.listener.status',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse(
      'Listener status (disabled / unreachable / ok).',
      listenerStatusProxyResponseSchema,
    ),
    ...commonErrorResponses,
  },
})
