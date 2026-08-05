import { finalizeEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { getZapReceiptSigner } from '@/lib/nostr/zap-receipts'

const PUBLISH_TIMEOUT_MS = 15_000

export async function publishNotificationNostrEvent(input: {
  deliveryId: string
  createdAt: Date
  kind: number
  recipient: string
  relays: string[]
  contentTemplate: string
  encrypt: boolean
  payload: unknown
}): Promise<{ eventId: string }> {
  const signer = await getZapReceiptSigner()
  if (!signer) throw new Error('Nostr notification signer is unavailable')
  const payloadJson = JSON.stringify(input.payload)
  const content = renderContent(
    input.contentTemplate,
    input.payload,
    payloadJson
  )
  const finalContent = input.encrypt
    ? nip44.encrypt(
        content,
        nip44.utils.getConversationKey(
          Buffer.from(signer.privateKeyHex, 'hex'),
          input.recipient
        )
      )
    : content
  const event = finalizeEvent(
    {
      kind: input.kind,
      created_at: Math.floor(input.createdAt.getTime() / 1000),
      content: finalContent,
      tags: [
        ['p', input.recipient],
        ['d', input.deliveryId],
        ['client', 'lawallet'],
        ...(input.encrypt ? [['encrypted', 'nip44']] : [])
      ]
    },
    Buffer.from(signer.privateKeyHex, 'hex')
  )
  const pool = new SimplePool()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      Promise.any(pool.publish(input.relays, event)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Nostr relay publication timed out')),
          PUBLISH_TIMEOUT_MS
        )
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    pool.close(input.relays)
  }
  return { eventId: event.id }
}

function renderContent(
  template: string,
  payload: unknown,
  payloadJson: string
): string {
  const source = payload as {
    action?: unknown
    eventKey?: unknown
    wallet?: { id?: unknown; name?: unknown }
    data?: { payment?: { paymentHash?: unknown; amountMsats?: unknown } }
  }
  const replacements: Record<string, string> = {
    payload: payloadJson,
    action: String(source.action ?? ''),
    eventKey: String(source.eventKey ?? ''),
    walletId: String(source.wallet?.id ?? ''),
    walletName: String(source.wallet?.name ?? ''),
    paymentHash: String(source.data?.payment?.paymentHash ?? ''),
    amountMsats: String(source.data?.payment?.amountMsats ?? '')
  }
  return (template || '{{payload}}').replace(
    /\{\{(payload|action|eventKey|walletId|walletName|paymentHash|amountMsats)\}\}/g,
    (_match, key: keyof typeof replacements) => replacements[key]
  )
}
