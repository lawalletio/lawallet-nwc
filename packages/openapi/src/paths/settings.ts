import {
  listenerProbeRequestSchema,
  listenerProbeResponseSchema
} from '@lawallet-nwc/shared'
import { z } from 'zod'
import {
  commonErrorResponses,
  inlineJsonResponse,
  protectedSecurity,
  withRole
} from '../helpers'
import { registry } from '../registry'
import { responses } from '../responses'
import { schemas } from '../schemas'

const TAG = 'Settings'

registry.registerPath({
  ...withRole('USER'),
  method: 'get',
  path: '/api/settings',
  tags: [TAG],
  summary: 'Read settings; anonymous callers see public keys only.',
  operationId: 'settings.get',
  security: protectedSecurity,
  responses: {
    200: inlineJsonResponse('Settings map.', z.record(z.string(), z.string())),
    ...commonErrorResponses
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings',
  tags: [TAG],
  summary: 'Upsert one or more settings.',
  operationId: 'settings.update',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: schemas.SettingsBody } }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Settings updated.',
      z.record(z.string(), z.string())
    ),
    ...commonErrorResponses
  }
})

const probeCheckSchema = z.object({
  state: z.enum(['pass', 'fail', 'skip']),
  url: z.string(),
  label: z.string(),
  detail: z.string()
})

const instructionProfileSchema = z.object({
  kind: z
    .enum([
      'lawallet',
      'wordpress',
      'htaccess',
      'nextjs',
      'vite',
      'php',
      'nginx',
      'vercel',
      'netlify',
      'cloudflare',
      'caddy',
      'static',
      'unknown'
    ])
    .optional(),
  label: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  snippet: z.string(),
  tip: z.string()
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings/domain-probe',
  tags: [TAG],
  summary: 'Check that a domain routes Lightning Address discovery here.',
  description:
    'Requires `settings:write`. Fetches the domain’s root page, ' +
    '`/.well-known/lawallet.json`, `/.well-known/lnurlp/…` and ' +
    '`/.well-known/nostr.json`, then stores `domain_verified` (`true` only ' +
    'when the result is `ready`). Returns rewrite instructions for the ' +
    'detected hosting platform.',
  operationId: 'settings.domainProbe',
  security: protectedSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            domain: z.string().min(1).openapi({
              description: 'Domain to check, without protocol.',
              example: 'example.com'
            }),
            endpoint: z.string().optional().openapi({
              description:
                'Origin LNURL callbacks must point at; defaults to the domain.'
            }),
            apiGatewayEndpoint: z
              .string()
              .optional()
              .openapi({
                description:
                  'Callback origin to expect instead when the domain is not ' +
                  'itself served by LaWallet.'
              })
          })
        }
      }
    }
  },
  responses: {
    200: inlineJsonResponse(
      'Probe result.',
      z.object({
        domain: z.string(),
        endpoint: z.string(),
        direct: z.boolean(),
        status: z.enum(['ready', 'rewrite-needed', 'pending']),
        checks: z.object({
          instance: probeCheckSchema,
          lnurl: probeCheckSchema,
          nip05: probeCheckSchema
        }),
        platform: z.object({
          kind: z.enum([
            'lawallet',
            'wordpress',
            'nextjs',
            'vite',
            'php',
            'nginx',
            'vercel',
            'netlify',
            'cloudflare',
            'static',
            'unknown'
          ]),
          label: z.string(),
          confidence: z.enum(['high', 'medium', 'low']),
          evidence: z.array(z.string())
        }),
        instructions: instructionProfileSchema,
        instructionOptions: z.array(instructionProfileSchema)
      })
    ),
    ...commonErrorResponses,
    413: responses.payloadTooLarge
  }
})

registry.registerPath({
  ...withRole('ADMIN'),
  method: 'post',
  path: '/api/settings/listener-probe',
  tags: [TAG],
  summary: 'Test the connection to an NWC listener.',
  description:
    'Requires `settings:write`. Calls `GET <url>/status` with the shared ' +
    'secret as a Bearer token; when `secret` is omitted it sends the stored ' +
    'or env secret. Probe outcomes are always 200 with `ok: false` and a ' +
    '`code` on failure.',
  operationId: 'settings.listenerProbe',
  security: protectedSecurity,
  request: {
    body: {
      content: { 'application/json': { schema: listenerProbeRequestSchema } }
    }
  },
  responses: {
    200: inlineJsonResponse('Probe outcome.', listenerProbeResponseSchema),
    ...commonErrorResponses
  }
})
