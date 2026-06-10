import { z } from 'zod'
import { NextResponse } from 'next/server'
import { authenticate, authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { ValidationError, NotFoundError } from '@/types/server/errors'
import { listRecords, putRecord } from '../_runtime/records'
import type { LawalletPlugin } from '../_runtime/types'

/**
 * Badges — the reference plugin (realizes a slice of docs/plugins/BADGES.md
 * as in-codebase code). Demonstrates every extension point:
 *
 *  - config:   Zod-validated JSON (autoAwardOnPayment)
 *  - routes:   GET/POST /api/plugins/badges/awards via the core catch-all
 *  - hooks:    invoice:paid → automatic "first-payment" badge
 *  - storage:  PluginRecord rows only — zero schema changes
 *  - client:   nav item + page in ./client.tsx
 */

const configSchema = z
  .object({
    autoAwardOnPayment: z.boolean().default(true)
  })
  .strict()

const awardSchema = z.object({
  pubkey: z.string().min(1),
  badge: z.string().min(1).max(64),
  reason: z.string().max(200).optional(),
  awardedAt: z.string().datetime()
})

export type BadgeAward = z.infer<typeof awardSchema>

const PLUGIN_ID = 'badges'
const KIND_AWARD = 'award'

async function award(pubkey: string, badge: string, reason?: string) {
  await putRecord(PLUGIN_ID, KIND_AWARD, `${pubkey}:${badge}`, awardSchema, {
    pubkey,
    badge,
    reason,
    awardedAt: new Date().toISOString()
  })
}

export const badgesPlugin: LawalletPlugin<z.infer<typeof configSchema>> = {
  id: PLUGIN_ID,
  name: 'Badges',
  version: '0.1.0',
  description: 'Award and list Nostr-style badges for community members',
  configSchema,
  defaultEnabled: false,

  async routes(request, { method, path }) {
    if (path[0] === 'awards' && method === 'GET') {
      // Any authenticated user can browse awards.
      await authenticate(request)
      const awards = await listRecords(PLUGIN_ID, KIND_AWARD, awardSchema)
      return NextResponse.json({ awards: awards.map(a => a.data) })
    }

    if (path[0] === 'awards' && method === 'POST') {
      // Granting badges is an operator action.
      await authenticateWithPermission(request, Permission.USERS_WRITE)
      const body = await request.json().catch(() => null)
      const input = z
        .object({
          pubkey: z.string().min(1),
          badge: z.string().min(1).max(64),
          reason: z.string().max(200).optional()
        })
        .safeParse(body)
      if (!input.success) {
        throw new ValidationError('Invalid award payload', input.error.issues)
      }

      await award(input.data.pubkey, input.data.badge, input.data.reason)
      return NextResponse.json({ success: true }, { status: 201 })
    }

    throw new NotFoundError('Unknown badges endpoint')
  },

  hooks: {
    'invoice:paid': async payload => {
      // Auto-award a "first-payment" badge to the paying user.
      await award(payload.userId, 'first-payment', 'Paid an invoice')
    }
  }
}
