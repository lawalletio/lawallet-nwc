import type { NWCClient as NWCClientT } from '@getalby/sdk'

type SdkModule = typeof import('@getalby/sdk')

let sdkPromise: Promise<SdkModule> | null = null
const clients = new Map<string, NWCClientT>()
const clientCreations = new Map<string, Promise<NWCClientT>>()

function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) sdkPromise = import('@getalby/sdk')
  return sdkPromise
}

/**
 * Server-side mirror of `lib/client/nwc/nwc-client.ts` — memoises one
 * `NWCClient` per connection string so a long-running server (Node, Vercel
 * fluid compute, etc.) doesn't pay the relay-handshake cost on every
 * request. Lambda-style cold starts naturally reset the cache.
 *
 * Tests can `vi.mock('@getalby/sdk', …)` to swap the underlying class.
 */
export async function getServerNwcClient(connectionString: string): Promise<NWCClientT> {
  const cached = clients.get(connectionString)
  if (cached) return cached

  const pending = clientCreations.get(connectionString)
  if (pending) return pending

  const creation = loadSdk()
    .then(({ NWCClient }) => {
      const existing = clients.get(connectionString)
      if (existing) return existing
      const client = new NWCClient({ nostrWalletConnectUrl: connectionString })
      clients.set(connectionString, client)
      return client
    })
    .finally(() => {
      if (clientCreations.get(connectionString) === creation) {
        clientCreations.delete(connectionString)
      }
    })
  clientCreations.set(connectionString, creation)
  return creation
}

/**
 * Close + forget the client for a connection string. Call when a
 * `RemoteWallet` is revoked or its connection URI rotates, so dangling relay
 * subscriptions don't linger.
 */
export function closeServerNwcClient(connectionString: string): void {
  const existing = clients.get(connectionString)
  if (!existing) return
  try {
    existing.close()
  } catch {
    // best-effort — already torn down or transport-dead is fine
  }
  clients.delete(connectionString)
}

/** Tear down every cached client. Used by tests + graceful shutdown. */
export function closeAllServerNwcClients(): void {
  for (const [, client] of clients) {
    try {
      client.close()
    } catch {
      // ignore
    }
  }
  clients.clear()
}
