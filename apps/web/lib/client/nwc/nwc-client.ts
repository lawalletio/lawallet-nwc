'use client'

import type { NWCClient as NWCClientT } from '@getalby/sdk'

type SdkModule = typeof import('@getalby/sdk')

let sdkPromise: Promise<SdkModule> | null = null
const clients = new Map<string, NWCClientT>()

function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) {
    sdkPromise = import('@getalby/sdk')
  }
  return sdkPromise
}

/**
 * Returns a memoised NWCClient for the given connection string so repeated
 * hook mounts share a single relay subscription. Release via
 * `closeNwcClient(nwcString)` on logout.
 */
export async function getNwcClient(nwcString: string): Promise<NWCClientT> {
  const existing = clients.get(nwcString)
  if (existing) return existing

  const { NWCClient } = await loadSdk()
  const client = new NWCClient({ nostrWalletConnectUrl: nwcString })
  clients.set(nwcString, client)
  return client
}

/** Close and forget a cached NWC client (e.g. on logout or URL change). */
export function closeNwcClient(nwcString: string) {
  const existing = clients.get(nwcString)
  if (!existing) return
  try {
    existing.close()
  } catch {
    // ignore
  }
  clients.delete(nwcString)
}

/** Close every cached client. Wired to auth logout. */
export function closeAllNwcClients() {
  for (const [, client] of clients) {
    try {
      client.close()
    } catch {
      // ignore
    }
  }
  clients.clear()
}
