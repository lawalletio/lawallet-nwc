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
        description: 'rest-docs',
      },
    ],
    security: [{ [BEARER_JWT]: [] }, { [NIP98]: [] }],
    tags: [
      {
        name: 'Roles & Permissions',
        description: [
          'LaWallet NWC uses an RBAC model with four hierarchical roles plus a `PUBLIC` tier for unauthenticated calls.',
          '',
          '## Hierarchy',
          '',
          '`PUBLIC → USER < VIEWER < OPERATOR < ADMIN`',
          '',
          'A higher role inherits everything the lower role can do — guards use `hasRole(actual, required)` against this order.',
          '',
          '| Role | Who | Privileges |',
          '|------|-----|------------|',
          '| **PUBLIC** | Unauthenticated caller | LUD-16 payRequest/callback, `/.well-known/verify`, `/api/setup/status`, `POST /api/jwt`. |',
          '| **USER** | Any authenticated pubkey with no extra grants | Reads/edits its own data only. No admin panel access. |',
          '| **VIEWER** | Auditor / observer | Read-only on cards, designs, addresses, ntags, users, settings, activity. |',
          '| **OPERATOR** | Day-to-day operator | VIEWER + write on cards, designs, addresses, ntags. Cannot touch settings or roles. |',
          '| **ADMIN** | System root | Every permission. Assigned to the first pubkey that claims the bootstrap via `POST /api/admin/assign`. |',
          '',
          '## Permission matrix',
          '',
          '| Permission | USER | VIEWER | OPERATOR | ADMIN |',
          '|------------|:----:|:------:|:--------:|:-----:|',
          '| `settings:read` | | ✓ | | ✓ |',
          '| `settings:write` | | | | ✓ |',
          '| `users:read` | | ✓ | ✓ | ✓ |',
          '| `users:write` | | | | ✓ |',
          '| `users:manage_roles` | | | | ✓ |',
          '| `cards:read` | | ✓ | ✓ | ✓ |',
          '| `cards:write` | | | ✓ | ✓ |',
          '| `card_designs:read` | | ✓ | ✓ | ✓ |',
          '| `card_designs:write` | | | ✓ | ✓ |',
          '| `addresses:read` | | ✓ | ✓ | ✓ |',
          '| `addresses:write` | | | ✓ | ✓ |',
          '| `ntags:read` | | ✓ | ✓ | ✓ |',
          '| `ntags:write` | | | ✓ | ✓ |',
          '| `activity:read` | | ✓ | ✓ | ✓ |',
          '',
          '## Role resolution',
          '',
          'Every authenticated request (NIP-98 or Bearer JWT) runs through `resolveRole(pubkey)`:',
          '',
          '1. Look up the `User` row for that pubkey. If `role !== USER`, return it.',
          '2. Otherwise, check the `root` setting (bootstrap fallback). If the pubkey matches → `ADMIN`.',
          '3. Otherwise → `USER`.',
          '',
          'The JWT bakes in the role at issuance time. **Changing a user\'s role does not invalidate their existing tokens** — the change is only visible after the next `POST /api/jwt`. Sensitive operations (role changes, settings writes) therefore require NIP-98 directly rather than accepting JWT.',
          '',
          '## How roles are granted',
          '',
          '- **Bootstrap (first admin):** the first pubkey to call `POST /api/admin/assign` with NIP-98 writes the `root` setting and becomes `ADMIN`. See the **Admin** section below.',
          '- **Promote / demote users:** requires the `users:manage_roles` permission (ADMIN only). Endpoint: `PUT /api/users/{userId}/role`.',
          '- **Self-demotion is blocked:** an admin cannot lower their own role, and the system prevents the last `ADMIN` from being removed.',
          '',
          '## Reading the badges',
          '',
          'Each operation in this reference shows a colored badge with the minimum required role (`PUBLIC`, `USER`, `VIEWER`, `OPERATOR`, `ADMIN`). Use them to scan at a glance which endpoints your signer can actually exercise.',
        ].join('\n'),
      },
      { name: 'Auth', description: 'NIP-98 → JWT exchange and validation.' },
      {
        name: 'Passkeys',
        description:
          'WebAuthn passkey signup, login, account linking, credential management, and custodied Nostr key release.',
      },
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
