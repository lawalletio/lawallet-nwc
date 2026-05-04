import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import type { OpenAPIObject } from 'openapi3-ts/oas31'
import { registry } from './registry'

// Side-effect imports register components and paths into the singleton
// registry. Order matters: schemas/security/responses must be registered
// before path modules that $ref them.
import './security'
import './responses'
import './schemas'
import './paths'

import { BEARER_JWT, NIP98 } from './security'

export const OPENAPI_VERSION = '0.1.0'

export interface OpenApiDocumentOptions {
  serverUrl?: string
}

export function getOpenApiDocument(options: OpenApiDocumentOptions = {}): OpenAPIObject {
  const generator = new OpenApiGeneratorV31(registry.definitions)

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'LaWallet NWC API',
      version: OPENAPI_VERSION,
      description:
        'REST API exposed by `apps/web`. Documents the platform endpoints used by ' +
        'the admin dashboard, lightning address resolution (LUD-16/21), wallet ' +
        'connections, and Nostr-backed authentication (NIP-98 / JWT).',
      license: { name: 'MIT' },
    },
    servers: [
      {
        url: options.serverUrl ?? 'http://localhost:3000',
        description: 'Local development',
      },
    ],
    security: [{ [BEARER_JWT]: [] }, { [NIP98]: [] }],
    tags: [
      { name: 'Auth', description: 'NIP-98 → JWT exchange and validation.' },
      { name: 'Cards', description: 'Card lifecycle: create, list, scan, write, OTC.' },
      { name: 'Card Designs', description: 'Visual templates assigned to cards.' },
      {
        name: 'Lightning Addresses',
        description: 'Admin-side lightning address inventory.',
      },
      {
        name: 'LUD-16',
        description: 'Public LUD-16 / LUD-21 / LUD-22 lightning address resolution.',
      },
      {
        name: 'Wallet',
        description: 'End-user wallet addresses and NWC connections.',
      },
      { name: 'Users', description: 'User profiles and role assignment.' },
      { name: 'Invoices', description: 'Pay-then-act invoices for registration flows.' },
      {
        name: 'Settings',
        description: 'Platform-wide settings persisted in the Settings store.',
      },
      { name: 'Admin', description: 'Admin role assignment and bootstrap.' },
      { name: 'Setup', description: 'Initial setup status checks.' },
      { name: 'Remote Connections', description: 'External device pairing for cards.' },
      { name: 'Activity', description: 'Activity log access.' },
      { name: 'Events', description: 'Server-Sent Events for real-time updates.' },
    ],
  })
}
