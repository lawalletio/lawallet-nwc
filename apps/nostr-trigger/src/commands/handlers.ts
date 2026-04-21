import { randomBytes } from 'node:crypto'
import type {
  AuditEvent,
  NostrTriggerAdmin,
  NwcConnection,
  WebhookEndpoint,
  ZapReceiptLedger
} from '@lawallet-nwc/prisma'
import { prisma } from '../db/prisma.js'
import { encryptSecret } from '../security/crypto.js'
import { parseNwcUri, derivePubkey } from '../nostr/nwc.js'
import { NotFoundError, ValidationError, ConflictError } from '../http/errors.js'
import type { ConnectionManager } from '../nostr/subscription-manager.js'
import type { ZapReceiptPublisher } from '../nostr/zap-publisher.js'
import type { RelayPool } from '../nostr/pool.js'
import type { RelayStatus } from '../nostr/pool.js'
import { queueDepth, enqueueWebhook } from '../webhooks/queue.js'
import { fetchWalletInfo, type WalletInfo } from '../nostr/info.js'
import { nwcRequest, type MakeInvoiceResult } from '../nostr/nwc-client.js'
import QRCode from 'qrcode'
import type {
  AddAdminInput,
  CreateNwcInput,
  CreateWebhookInput,
  PublishZapInput,
  UpdateNwcInput
} from './types.js'

export type Actor = { source: 'http' | 'nostr'; pubkey?: string }

/**
 * Runtime deps that handlers need to mutate system state. Assembled in
 * src/index.ts and injected where HTTP routes or the Nostr control plane
 * dispatch commands.
 */
export type CommandDeps = {
  connectionManager: ConnectionManager
  zapPublisher: ZapReceiptPublisher
  relayPool: RelayPool
}

export type Handlers = ReturnType<typeof createHandlers>

export function createHandlers(deps: CommandDeps) {
  return {
    status: async () => ({
      uptimeSeconds: Math.floor(process.uptime()),
      relays: deps.relayPool.status(),
      activeSubs: deps.connectionManager.activeSubCount(),
      queue: await queueDepth()
    }),

    listNwc: async (): Promise<NwcConnection[]> =>
      prisma.nwcConnection.findMany({
        orderBy: { createdAt: 'desc' }
      }),

    getNwc: async (id: string): Promise<NwcConnection> => {
      const c = await prisma.nwcConnection.findUnique({ where: { id } })
      if (!c) throw new NotFoundError('NWC connection not found')
      return c
    },

    probeNwcInfo: async (id: string): Promise<WalletInfo> => {
      const c = await prisma.nwcConnection.findUnique({ where: { id } })
      if (!c) throw new NotFoundError('NWC connection not found')
      return fetchWalletInfo(deps.relayPool, c.walletPubkey, c.relays)
    },

    makeInvoice: async (
      id: string,
      input: { amountSats: number; description?: string; expirySeconds?: number },
      actor: Actor
    ): Promise<{
      invoice: string
      amountSats: number
      expiresAt: number | null
      qrSvg: string
      paymentHash: string | null
    }> => {
      if (!Number.isInteger(input.amountSats) || input.amountSats <= 0) {
        throw new ValidationError('amountSats must be a positive integer')
      }
      const c = await prisma.nwcConnection.findUnique({ where: { id } })
      if (!c) throw new NotFoundError('NWC connection not found')

      const response = await nwcRequest<MakeInvoiceResult>(
        deps.relayPool,
        c,
        'make_invoice',
        {
          amount: input.amountSats * 1000,
          description: input.description ?? '',
          ...(input.expirySeconds ? { expiry: input.expirySeconds } : {})
        }
      )

      if (!response.ok) {
        throw new ValidationError(
          `wallet rejected make_invoice: ${response.error.code} — ${response.error.message}`
        )
      }

      const invoice = response.result?.invoice
      if (!invoice) {
        throw new ValidationError('wallet returned no invoice')
      }

      const qrSvg = await QRCode.toString(invoice.toUpperCase(), {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
        color: { dark: '#e6e8ec', light: '#15181d' }
      })

      await audit('make_invoice', c.id, actor, {
        amountSats: input.amountSats,
        paymentHash: response.result?.payment_hash
      })

      return {
        invoice,
        amountSats: input.amountSats,
        expiresAt: response.result?.expires_at ?? null,
        paymentHash: response.result?.payment_hash ?? null,
        qrSvg
      }
    },

    createNwc: async (
      input: CreateNwcInput,
      actor: Actor
    ): Promise<NwcConnection> => {
      const parsed = parseNwcUri(input.nwcUri)
      const clientPubkey = derivePubkey(parsed.clientSecret)

      const connection = await prisma.nwcConnection.create({
        data: {
          label: input.label,
          walletPubkey: parsed.walletPubkey,
          clientPubkey,
          clientSecret: encryptSecret(parsed.clientSecret),
          relays: parsed.relays,
          ownerUserId: input.ownerUserId,
          enabled: input.enabled
        }
      })

      await audit('create_nwc', connection.id, actor, {
        walletPubkey: connection.walletPubkey,
        relayCount: connection.relays.length
      })

      if (connection.enabled) {
        await deps.connectionManager.open(connection.id)
      }
      return connection
    },

    updateNwc: async (
      id: string,
      input: UpdateNwcInput,
      actor: Actor
    ): Promise<NwcConnection> => {
      const existing = await prisma.nwcConnection.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError('NWC connection not found')

      const updated = await prisma.nwcConnection.update({
        where: { id },
        data: {
          label: input.label ?? existing.label,
          enabled: input.enabled ?? existing.enabled,
          relays: input.relays ?? existing.relays
        }
      })

      await audit('update_nwc', id, actor, input as Record<string, unknown>)
      await deps.connectionManager.reload(id)
      if (!updated.enabled) await deps.connectionManager.close(id)
      return updated
    },

    deleteNwc: async (id: string, actor: Actor): Promise<void> => {
      const c = await prisma.nwcConnection.findUnique({ where: { id } })
      if (!c) throw new NotFoundError('NWC connection not found')
      await deps.connectionManager.close(id)
      await prisma.nwcConnection.delete({ where: { id } })
      await audit('delete_nwc', id, actor)
    },

    listWebhooks: async (nwcId: string): Promise<WebhookEndpoint[]> =>
      prisma.webhookEndpoint.findMany({
        where: { nwcConnectionId: nwcId },
        orderBy: { createdAt: 'desc' }
      }),

    listAllWebhooks: async () => {
      const rows = await prisma.webhookEndpoint.findMany({
        include: { nwcConnection: { select: { id: true, label: true } } },
        orderBy: { createdAt: 'desc' }
      })
      // never expose the (even encrypted) secret to the dashboard
      return rows.map(({ secret: _s, ...rest }) => rest)
    },

    createWebhook: async (
      input: CreateWebhookInput,
      actor: Actor
    ): Promise<Omit<WebhookEndpoint, 'secret'> & { secret: string }> => {
      const nwc = await prisma.nwcConnection.findUnique({
        where: { id: input.nwcConnectionId }
      })
      if (!nwc) throw new NotFoundError('NWC connection not found')

      const plainSecret = input.secret ?? randomBytes(32).toString('hex')
      const created = await prisma.webhookEndpoint.create({
        data: {
          nwcConnectionId: input.nwcConnectionId,
          url: input.url,
          secret: encryptSecret(plainSecret),
          eventKinds: input.eventKinds,
          enabled: input.enabled
        }
      })

      await audit('create_webhook', created.id, actor, { url: created.url })
      return { ...created, secret: plainSecret }
    },

    deleteWebhook: async (id: string, actor: Actor): Promise<void> => {
      const ep = await prisma.webhookEndpoint.findUnique({ where: { id } })
      if (!ep) throw new NotFoundError('Webhook endpoint not found')
      await prisma.webhookEndpoint.delete({ where: { id } })
      await audit('delete_webhook', id, actor)
    },

    testWebhook: async (id: string, actor: Actor): Promise<{ enqueued: boolean }> => {
      const ep = await prisma.webhookEndpoint.findUnique({ where: { id } })
      if (!ep) throw new NotFoundError('Webhook endpoint not found')
      await enqueueWebhook({
        webhookEndpointId: ep.id,
        eventId: `test-${Date.now()}`,
        eventKind: 0,
        nwcConnectionId: ep.nwcConnectionId,
        payload: { test: true, message: 'nostr-trigger test event' }
      })
      await audit('test_webhook', id, actor)
      return { enqueued: true }
    },

    listRelays: async (): Promise<RelayStatus[]> => deps.relayPool.status(),

    reloadRelays: async (actor: Actor): Promise<{ reloaded: number }> => {
      await deps.connectionManager.reloadAll()
      await audit('reload_relays', 'all', actor)
      return { reloaded: deps.connectionManager.activeSubCount() }
    },

    listAdmins: async (): Promise<NostrTriggerAdmin[]> =>
      prisma.nostrTriggerAdmin.findMany({ orderBy: { createdAt: 'desc' } }),

    addAdmin: async (
      input: AddAdminInput,
      actor: Actor
    ): Promise<NostrTriggerAdmin> => {
      const existing = await prisma.nostrTriggerAdmin.findUnique({
        where: { pubkey: input.pubkey }
      })
      if (existing) throw new ConflictError('Pubkey is already an admin')
      const created = await prisma.nostrTriggerAdmin.create({
        data: {
          pubkey: input.pubkey,
          label: input.label,
          addedBy: actor.pubkey
        }
      })
      await audit('add_admin', created.id, actor, { pubkey: input.pubkey })
      return created
    },

    removeAdmin: async (id: string, actor: Actor): Promise<void> => {
      const a = await prisma.nostrTriggerAdmin.findUnique({ where: { id } })
      if (!a) throw new NotFoundError('Admin entry not found')
      await prisma.nostrTriggerAdmin.delete({ where: { id } })
      await audit('remove_admin', id, actor, { pubkey: a.pubkey })
    },

    auditTail: async (limit: number): Promise<AuditEvent[]> =>
      prisma.auditEvent.findMany({
        orderBy: { ts: 'desc' },
        take: Math.min(Math.max(1, limit), 500)
      }),

    publishZap: async (
      input: PublishZapInput,
      actor: Actor
    ): Promise<{ eventId: string; relays: string[] }> => {
      if (input.zapRequest.kind !== 9734) {
        throw new ValidationError('zapRequest.kind must be 9734')
      }
      const { eventId, relays } = await deps.zapPublisher.publish(input)
      await audit('publish_zap', eventId, actor, {
        recipient: input.recipientPubkey,
        relays
      })
      return { eventId, relays }
    }
  }
}

async function audit(
  action: string,
  target: string | null,
  actor: Actor,
  payload?: Record<string, unknown>
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      source: actor.source,
      actor: actor.pubkey ?? null,
      action,
      target,
      payload: payload as object | undefined
    }
  })
}

export type ZapReceiptPublic = Omit<ZapReceiptLedger, never>
