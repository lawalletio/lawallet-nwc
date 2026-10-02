// MCP endpoint operations (`/api/mcp`, `/api/mcp/public`).
import { z } from 'zod'
import {
  inlineJsonResponse,
  noContent,
  publicSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { BEARER_JWT } from '../security'

const TAG = 'MCP'

const jsonRpcId = z.union([z.string(), z.number()])

const jsonRpcMessage = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: jsonRpcId
      .optional()
      .openapi({ description: 'Absent for a notification.' }),
    method: z.string().openapi({
      example: 'tools/call',
      description:
        '`initialize`, `ping`, `server/discover`, `tools/list` or `tools/call`.'
    }),
    params: z.record(z.string(), z.unknown()).optional()
  })
  .openapi({ description: 'A JSON-RPC 2.0 request or notification.' })

const jsonRpcResponse = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: jsonRpcId.nullable(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: z.unknown().optional()
      })
      .optional()
  })
  .openapi({ description: 'A JSON-RPC 2.0 response.' })

const request = {
  body: {
    content: {
      'application/json': {
        schema: z.union([jsonRpcMessage, z.array(jsonRpcMessage)])
      }
    }
  }
}

const protocolResponses = {
  200: inlineJsonResponse(
    'JSON-RPC response (an array for a batch). Tool failures are results with `isError: true`.',
    z.union([jsonRpcResponse, z.array(jsonRpcResponse)])
  ),
  202: noContent('Notification accepted.'),
  400: inlineJsonResponse(
    'Malformed JSON-RPC, a header that disagrees with the body (`-32020`), an unsupported protocol version (`-32022`) or missing request metadata.',
    jsonRpcResponse
  ),
  404: inlineJsonResponse(
    'Unknown method of the 2026-07-28 revision (`-32601`).',
    jsonRpcResponse
  ),
  413: responses.payloadTooLarge,
  429: responses.rateLimited
}

const description = (audience: string) =>
  'Model Context Protocol over Streamable HTTP, stateless: every POST gets ' +
  'one `application/json` answer, with no SSE stream and no session. Serves ' +
  'the 2026-07-28 revision (per-request `_meta`, `server/discover`) and the ' +
  'initialize-based revisions 2025-11-25, 2025-06-18, 2025-03-26 and ' +
  `2024-11-05 on the same URL. ${audience} Tools are derived from this ` +
  'OpenAPI document and run the real REST handlers; secrets are redacted ' +
  'from every result.'

registry.registerPath({
  ...withRole('USER'),
  method: 'post',
  path: '/api/mcp',
  tags: [TAG],
  summary: 'MCP endpoint for signed-in agents.',
  description: description(
    'Takes an OAuth access token issued by this instance (scopes `read`, ' +
      '`write`, `spend`) or a session/device JWT (`read` + `write`). Without ' +
      'valid credentials it answers 401 with a `WWW-Authenticate` challenge ' +
      'pointing at the protected-resource metadata, which starts the OAuth flow.'
  ),
  operationId: 'mcp.call',
  security: [{ [BEARER_JWT]: [] }],
  request,
  responses: {
    ...protocolResponses,
    401: inlineJsonResponse(
      'Missing or rejected Bearer token. `WWW-Authenticate` names the protected-resource metadata, which starts OAuth.',
      z.object({
        error: z.enum(['invalid_token', 'unauthorized']),
        error_description: z.string()
      })
    )
  }
})

registry.registerPath({
  ...withRole('PUBLIC'),
  method: 'post',
  path: '/api/mcp/public',
  tags: [TAG],
  summary: 'MCP endpoint for anonymous agents.',
  description: description(
    'Anonymous: only public tools are listed — lightning-address lookups and ' +
      'instance information. Credentials are ignored, never rejected.'
  ),
  operationId: 'mcp.public.call',
  security: publicSecurity,
  request,
  responses: protocolResponses
})
