import { finalizeEvent, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import type { NwcConnection } from '@lawallet-nwc/prisma'
import { createChildLogger } from '../logger.js'
import { decryptSecret } from '../security/crypto.js'
import { decryptWithFallback, encryptNip04 } from './encryption.js'
import type { RelayPool } from './pool.js'

const log = createChildLogger({ module: 'nwc-client' })

export type NwcError = {
  code: string
  message: string
}

export type NwcResponse<T = unknown> =
  | { ok: true; resultType: string; result: T }
  | { ok: false; error: NwcError }

type ResponseBody = {
  result_type?: string
  result?: unknown
  error?: NwcError
}

/**
 * Sends a NIP-47 request to the wallet service and waits for the paired
 * response. Opens a short-lived subscription filtered by `#e=request.id`,
 * publishes the request, then resolves when the response is decrypted.
 *
 * The subscription closes whether we get a response, an error, or a timeout —
 * and the request-id subId keeps it independent from the long-lived
 * notification subscription already maintained by ConnectionManager.
 */
export function nwcRequest<T = unknown>(
  pool: RelayPool,
  connection: NwcConnection,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15000
): Promise<NwcResponse<T>> {
  return new Promise<NwcResponse<T>>((resolve, reject) => {
    const clientSkHex = decryptSecret(connection.clientSecret)
    const clientSk = hexToBytes(clientSkHex)

    // NIP-04 for request encryption — widest compatibility across NWC wallets
    // (Coinos and many others advertise no `encryption` tag, which per NIP-47
    // defaults to NIP-04 only). Responses are decrypted with both-fallback.
    const encrypted = encryptNip04(
      clientSkHex,
      connection.walletPubkey,
      JSON.stringify({ method, params })
    )

    const request = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', connection.walletPubkey]],
        content: encrypted
      },
      clientSk
    )

    let settled = false

    const subId = `nwc-req-${request.id.slice(0, 12)}`
    const handle = pool.subscribe({
      subId,
      relays: connection.relays,
      filter: {
        kinds: [23195],
        authors: [connection.walletPubkey],
        '#e': [request.id],
        since: Math.floor(Date.now() / 1000) - 10
      },
      onEvent: (event: Event) => {
        if (settled) return
        try {
          const plaintext = decryptWithFallback(
            clientSkHex,
            connection.walletPubkey,
            event.content
          )
          const body = JSON.parse(plaintext) as ResponseBody
          settled = true
          clearTimeout(timer)
          try {
            handle.close()
          } catch {
            /* ignore */
          }
          if (body.error) {
            resolve({ ok: false, error: body.error })
          } else {
            resolve({
              ok: true,
              resultType: body.result_type ?? method,
              result: body.result as T
            })
          }
        } catch (err) {
          settled = true
          clearTimeout(timer)
          try {
            handle.close()
          } catch {
            /* ignore */
          }
          reject(err)
        }
      }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        handle.close()
      } catch {
        /* ignore */
      }
      reject(
        new Error(
          `NWC ${method} request timed out after ${timeoutMs}ms on ${connection.relays.join(', ')}`
        )
      )
    }, timeoutMs)

    // Fire the request only after subscribing so we don't miss a fast response
    pool.publish(connection.relays, request).then(
      ({ accepted, rejected }) => {
        log.debug(
          {
            method,
            accepted: accepted.length,
            rejected: rejected.length,
            nwcId: connection.id
          },
          'nwc request published'
        )
        if (accepted.length === 0 && !settled) {
          settled = true
          clearTimeout(timer)
          try {
            handle.close()
          } catch {
            /* ignore */
          }
          reject(
            new Error(
              `No relays accepted the ${method} request (rejected by: ${rejected.map(r => r.relay).join(', ')})`
            )
          )
        }
      },
      err => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          handle.close()
        } catch {
          /* ignore */
        }
        reject(err)
      }
    )
  })
}

export type MakeInvoiceResult = {
  type?: string
  invoice: string
  description?: string
  description_hash?: string
  preimage?: string
  payment_hash?: string
  amount?: number
  fees_paid?: number
  created_at?: number
  expires_at?: number
}
