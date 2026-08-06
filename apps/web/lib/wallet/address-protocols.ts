import { getActiveProxyConfig } from '@/lib/proxy/config'
import { getListenerConfig } from '@/lib/listener-config'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'
import { resolveAccountPubkey } from '@/lib/nostr/account-pubkey'
import type { LightningAddressProbeResult } from '@/lib/lnurl-probe'

export const ADDRESS_PROTOCOL_KEYS = [
  'lud16',
  'nip05',
  'lud21',
  'nip57',
  'lud12'
] as const

export type AddressProtocolKey = (typeof ADDRESS_PROTOCOL_KEYS)[number]

/** `null` means "not determinable here", which is not the same as unsupported. */
export type AddressProtocolSupport = Record<
  AddressProtocolKey,
  boolean | null
>

export interface AddressProtocols {
  protocols: AddressProtocolSupport
  source: 'proxy' | 'wallet' | 'alias' | 'unavailable'
  reason: string | null
  /** The address actually serving these, when it is not this one. */
  provider: string | null
}

/** Shape persisted in `LightningAddress.aliasProtocols`. */
export interface StoredAliasProtocols {
  lud16: boolean
  lud21: boolean
  nip57: boolean
  lud12: boolean
  checkedAt: string
}

export function aliasProtocolsFromProbe(
  probe: LightningAddressProbeResult
): StoredAliasProtocols {
  return {
    lud16: probe.checks.lud16.ok,
    lud21: probe.checks.lud21.ok,
    nip57: probe.checks.nip57.ok,
    lud12: probe.checks.lud12.ok,
    checkedAt: new Date().toISOString()
  }
}

function parseStored(value: unknown): StoredAliasProtocols | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.checkedAt !== 'string') return null
  const flag = (key: string) => v[key] === true
  return {
    lud16: flag('lud16'),
    lud21: flag('lud21'),
    nip57: flag('nip57'),
    lud12: flag('lud12'),
    checkedAt: v.checkedAt
  }
}

const NONE: AddressProtocolSupport = {
  lud16: false,
  nip05: false,
  lud21: false,
  nip57: false,
  lud12: false
}

export interface AddressProtocolInput {
  mode: string
  redirect: string | null
  aliasProtocols: unknown
  /** Whether the address currently has a usable receiving route. */
  routable: boolean
  user: Parameters<typeof resolveAccountPubkey>[0] | null | undefined
}

/**
 * What a Lightning Address actually offers to a payer right now.
 *
 * The answer depends on who ends up serving the payRequest:
 *   - ALIAS       → the alias target does; read from the probe stored when the
 *                   redirect was saved. Unknown until it has been probed.
 *   - PROXY_ALIAS → this instance's proxy does.
 *   - CUSTOM_NWC  → this instance does, using the bound wallet.
 *   - IDLE        → nothing is served.
 *
 * NIP-05 is ours in every case: it is this domain publishing the name, not the
 * payment route, so it only needs the account to have a usable pubkey.
 */
export async function resolveAddressProtocols(
  input: AddressProtocolInput
): Promise<AddressProtocols> {
  // Never let a capability read break the route that carries it: an account
  // with a malformed or absent key simply has no NIP-05.
  let nip05 = false
  try {
    nip05 = input.user ? resolveAccountPubkey(input.user) !== null : false
  } catch {
    nip05 = false
  }

  if (input.mode === 'IDLE') {
    return {
      protocols: { ...NONE, nip05 },
      source: 'unavailable',
      reason: 'This address is disabled and rejects payments.',
      provider: null
    }
  }

  if (input.mode === 'ALIAS') {
    const stored = parseStored(input.aliasProtocols)
    if (!stored) {
      return {
        protocols: {
          lud16: null,
          nip05,
          lud21: null,
          nip57: null,
          lud12: null
        },
        source: 'alias',
        reason: input.redirect
          ? `Save the redirect again to check what ${input.redirect} supports.`
          : 'This alias has no destination yet.',
        provider: input.redirect
      }
    }
    return {
      protocols: {
        lud16: stored.lud16,
        nip05,
        lud21: stored.lud21,
        nip57: stored.nip57,
        lud12: stored.lud12
      },
      source: 'alias',
      reason: null,
      provider: input.redirect
    }
  }

  if (input.mode === 'PROXY_ALIAS') {
    const [proxy, listener] = await Promise.all([
      getActiveProxyConfig(),
      getListenerConfig()
    ])
    const ready = Boolean(proxy && listener.enabled)
    const nip57 = Boolean(
      ready && proxy?.receiptPrivateKey && proxy.row.receiptPubkey
    )
    return {
      protocols: {
        lud16: ready,
        nip05,
        lud21: ready,
        nip57,
        lud12: ready
      },
      source: ready ? 'proxy' : 'unavailable',
      reason: ready
        ? nip57
          ? null
          : 'The proxy zap receipt signer is not configured.'
        : 'Deferred proxy requires an enabled listener and proxy wallet.',
      provider: null
    }
  }

  // CUSTOM_NWC — served by us through the bound wallet.
  const capability = await getZapReceiptCapability()
  return {
    protocols: {
      lud16: input.routable,
      nip05,
      lud21: input.routable && capability.lud21,
      nip57: input.routable && capability.nip57,
      // The callback advertises a comment budget for every invoice it mints.
      lud12: input.routable
    },
    source: input.routable ? 'wallet' : 'unavailable',
    reason: input.routable
      ? capability.reason
      : 'This address has no active receiving wallet.',
    provider: null
  }
}
