import { finalizeEvent, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { prisma } from '../db/prisma.js'
import { getConfig } from '../config/index.js'
import { createChildLogger } from '../logger.js'
import { claimEventId } from '../ingest/dedup.js'
import { decryptWithFallback, encryptNip44 } from './encryption.js'
import { derivePubkey, nsecToHex } from './nwc.js'
import type { RelayPool } from './pool.js'
import type { Handlers } from '../commands/handlers.js'
import { nostrCommandSchema, type NostrCommand } from '../commands/types.js'

const log = createChildLogger({ module: 'nostr-control-plane' })

const SUB_ID = 'control-plane'
const DM_KINDS = [4]

export class NostrControlPlane {
  private secretHex: string
  private servicePubkey: string

  constructor(
    private pool: RelayPool,
    private handlers: Handlers
  ) {
    const { serviceNsec } = getConfig().nostr
    this.secretHex = nsecToHex(serviceNsec)
    this.servicePubkey = derivePubkey(this.secretHex)
  }

  pubkey(): string {
    return this.servicePubkey
  }

  start(): void {
    const { controlRelays } = getConfig().nostr
    if (controlRelays.length === 0) {
      log.warn('NT_CONTROL_RELAYS empty — nostr control plane disabled')
      return
    }

    const since = Math.floor(Date.now() / 1000)

    this.pool.subscribe({
      subId: SUB_ID,
      relays: controlRelays,
      filter: {
        kinds: DM_KINDS,
        '#p': [this.servicePubkey],
        since
      },
      onEvent: (event: Event, relayUrl: string) => {
        void this.handle(event, relayUrl).catch(err =>
          log.error({ err, eventId: event.id }, 'control-plane handler error')
        )
      }
    })

    log.info(
      { servicePubkey: this.servicePubkey, relays: controlRelays },
      'nostr control plane started'
    )
  }

  private async handle(event: Event, _relayUrl: string): Promise<void> {
    if (!(await claimEventId(event.id))) return

    let plaintext: string
    try {
      plaintext = decryptWithFallback(
        this.secretHex,
        event.pubkey,
        event.content
      )
    } catch (err) {
      log.warn({ err, eventId: event.id }, 'could not decrypt DM')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(plaintext)
    } catch {
      await this.reply(event.pubkey, {
        id: '',
        ok: false,
        error: 'payload is not valid JSON'
      })
      return
    }

    const cmdResult = nostrCommandSchema.safeParse(parsed)
    if (!cmdResult.success) {
      await this.reply(event.pubkey, {
        id: (parsed as { id?: string })?.id ?? '',
        ok: false,
        error: `invalid command: ${cmdResult.error.errors.map(e => e.message).join('; ')}`
      })
      return
    }

    const authorized = await this.authorize(event.pubkey)
    if (!authorized) {
      log.warn({ pubkey: event.pubkey }, 'unauthorized nostr command sender')
      await this.reply(event.pubkey, {
        id: cmdResult.data.id,
        ok: false,
        error: 'unauthorized'
      })
      return
    }

    const command = cmdResult.data
    const actor = { source: 'nostr' as const, pubkey: event.pubkey }

    try {
      const result = await this.dispatch(command, actor)
      await this.reply(event.pubkey, {
        id: command.id,
        ok: true,
        result
      })
    } catch (err) {
      log.error({ err, op: command.op }, 'command handler threw')
      await this.reply(event.pubkey, {
        id: command.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async authorize(pubkey: string): Promise<boolean> {
    const admin = await prisma.nostrTriggerAdmin.findUnique({
      where: { pubkey }
    })
    if (admin) return true
    const user = await prisma.user.findUnique({ where: { pubkey } })
    return user?.role === 'ADMIN'
  }

  private async dispatch(
    cmd: NostrCommand,
    actor: { source: 'nostr'; pubkey: string }
  ): Promise<unknown> {
    const h = this.handlers
    switch (cmd.op) {
      case 'status':
        return h.status()
      case 'list_nwc':
        return h.listNwc()
      case 'get_nwc':
        return h.getNwc(cmd.nwcConnectionId)
      case 'create_nwc':
        return h.createNwc(cmd.params, actor)
      case 'update_nwc':
        return h.updateNwc(cmd.nwcConnectionId, cmd.params, actor)
      case 'delete_nwc':
        await h.deleteNwc(cmd.nwcConnectionId, actor)
        return { deleted: true }
      case 'list_webhooks':
        return h.listWebhooks(cmd.nwcConnectionId)
      case 'create_webhook':
        return h.createWebhook(cmd.params, actor)
      case 'delete_webhook':
        await h.deleteWebhook(cmd.webhookEndpointId, actor)
        return { deleted: true }
      case 'test_webhook':
        return h.testWebhook(cmd.webhookEndpointId, actor)
      case 'list_relays':
        return h.listRelays()
      case 'reload_relays':
        return h.reloadRelays(actor)
      case 'list_admins':
        return h.listAdmins()
      case 'add_admin':
        return h.addAdmin(cmd.params, actor)
      case 'remove_admin':
        await h.removeAdmin(cmd.adminId, actor)
        return { removed: true }
      case 'audit_tail':
        return h.auditTail(cmd.limit)
      case 'publish_zap':
        return h.publishZap(cmd.params, actor)
    }
  }

  private async reply(
    recipientPubkey: string,
    body: { id: string; ok: boolean; result?: unknown; error?: string }
  ): Promise<void> {
    const content = encryptNip44(
      this.secretHex,
      recipientPubkey,
      JSON.stringify(body)
    )
    const template = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubkey]],
      content
    }
    const event = finalizeEvent(template, hexToBytes(this.secretHex))
    const { controlRelays } = getConfig().nostr
    await this.pool.publish(controlRelays, event)
  }
}
