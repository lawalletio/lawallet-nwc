import type { RemoteWallet, RemoteWalletStatus } from '@/lib/generated/prisma'
import {
  toWireCustody,
  type RemoteWalletCustodyWire
} from '@/lib/remote-wallets/custody'

/**
 * Wire shape returned by the `/api/remote-wallets` routes. Deliberately
 * **omits** `config` and `userId`: `config` carries secrets (NWC URI) and
 * `userId` is implicit from the authenticated caller. Reveal endpoints live
 * separately.
 */
export interface RemoteWalletDto {
  id: string
  name: string
  type: RemoteWallet['type']
  status: RemoteWalletStatus
  isDefault: boolean
  /** Where the credentials are kept: `both`, `backend` or `local`. */
  custody: RemoteWalletCustodyWire
  createdAt: string
  updatedAt: string
  /** Set only for archived (DEAD) wallets — when the wallet was detected dead. */
  diedAt: string | null
  /** Why it was archived: `unresponsive`, `idle` or `warmup_failed`. Null unless DEAD. */
  diedReason: string | null
  /** `'lncurl'` for a disposable LNCurl-provisioned wallet, else null. Drives the UI tag + countdown. */
  provider: 'lncurl' | null
  /** For LNCurl wallets, the server that minted THIS wallet (stored per-wallet, so a later settings change doesn't move it). Null otherwise. */
  lncurlServerUrl: string | null
}

export function toRemoteWalletDto(w: RemoteWallet): RemoteWalletDto {
  const cfg = w.config as {
    provider?: unknown
    lncurlServerUrl?: unknown
  } | null
  const isLncurl = cfg?.provider === 'lncurl'
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    isDefault: w.isDefault,
    custody: toWireCustody(w.custody),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    diedAt: w.diedAt ? w.diedAt.toISOString() : null,
    diedReason: w.diedReason,
    provider: isLncurl ? 'lncurl' : null,
    lncurlServerUrl:
      isLncurl && typeof cfg?.lncurlServerUrl === 'string'
        ? cfg.lncurlServerUrl
        : null
  }
}
